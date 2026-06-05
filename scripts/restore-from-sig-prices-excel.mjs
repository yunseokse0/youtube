#!/usr/bin/env node
/**
 * sig-prices-*.xlsx (가격 다운로드 형식) → 서버 POST /api/state sigInventory 전체 복구
 *
 *   BASE_URL=http://13.124.114.125 USER=finalent node scripts/restore-from-sig-prices-excel.mjs "C:\Users\...\sig-prices.xlsx"
 *   node scripts/restore-from-sig-prices-excel.mjs --dry-run data/sig-prices.xlsx
 */
import fs from "fs/promises";
import path from "path";
import XLSX from "xlsx";

const ROOT = process.cwd();
const BASE_URL = (
  process.env.SIG_CATALOG_BASE_URL ||
  process.env.BASE_URL ||
  "http://13.124.114.125"
).replace(/\/$/, "");
const USER =
  process.env.SIG_CATALOG_USER ||
  process.env.USER_ID ||
  process.env.USER ||
  "finalent";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const fileArg = args.find((a) => !a.startsWith("--"));

function yn(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  return s === "y" || s === "yes" || s === "true" || s === "1";
}

function toSigItem(row) {
  const name = String(row.name ?? row["이름"] ?? "").trim();
  if (!name) return null;
  const id =
    String(row.id ?? row["ID"] ?? "").trim() ||
    `sig_excel_${name.replace(/\s+/g, "_").slice(0, 40)}`;
  return {
    id,
    name,
    price: Math.max(0, Math.floor(Number(row.price ?? row["가격"]) || 0)),
    imageUrl: String(row.imageUrl ?? row["이미지URL"] ?? "").trim(),
    memberId: "",
    maxCount: Math.max(1, Math.floor(Number(row.maxCount ?? row["최대수량"]) || 1)),
    soldCount: Math.max(0, Math.floor(Number(row.soldCount ?? row["판매수"]) || 0)),
    isActive: yn(row.isActive ?? row["판매활성"] ?? "Y"),
    isRolling: yn(row.isRolling ?? row["롤링노출"] ?? "Y"),
  };
}

async function postInventory(sigInventory, extra = {}) {
  const q = new URLSearchParams({ user: USER, u: USER });
  const res = await fetch(`${BASE_URL}/api/state?${q.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sigInventory, updatedAt: Date.now(), ...extra }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST 실패 HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text.trim() ? JSON.parse(text) : {};
}

async function main() {
  if (!fileArg) {
    console.error("사용: node scripts/restore-from-sig-prices-excel.mjs <엑셀경로>");
    process.exit(1);
  }
  const filePath = path.resolve(fileArg);
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet);
  const sigInventory = [];
  let skipped = 0;
  const seen = new Set();
  for (const row of rows) {
    const item = toSigItem(row);
    if (!item) {
      skipped += 1;
      continue;
    }
    const key = item.id || item.name;
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    sigInventory.push(item);
  }
  console.log(`[restore-from-sig-prices-excel] ${path.basename(filePath)}`);
  console.log(`  복구 시그: ${sigInventory.length}개 (스킵 ${skipped})`);
  if (dryRun) {
    console.log("  --dry-run: POST 생략");
    return;
  }
  const extra = {};
  const stateJsonPath = process.env.STATE_JSON;
  if (stateJsonPath) {
    const raw = await fs.readFile(path.resolve(stateJsonPath), "utf8");
    const st = JSON.parse(raw);
    if (Array.isArray(st.members)) extra.members = st.members;
    if (Array.isArray(st.donors)) extra.donors = st.donors;
    if (st.memberPositions) extra.memberPositions = st.memberPositions;
    console.log(
      `  + 상태 JSON: 멤버 ${extra.members?.length ?? 0} · 후원 ${extra.donors?.length ?? 0}`
    );
  }
  const result = await postInventory(sigInventory, extra);
  console.log(`  저장 완료 updatedAt=${result.updatedAt ?? "?"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
