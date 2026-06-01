#!/usr/bin/env node
/**
 * data/sig-inventory-live.json (또는 지정 JSON) → 서버 POST /api/state sigInventory 복구.
 *
 *   BASE_URL=http://43.200.177.132 USER=finalent node scripts/restore-sig-inventory-snapshot.mjs
 *   node scripts/restore-sig-inventory-snapshot.mjs --dry-run
 *   node scripts/restore-sig-inventory-snapshot.mjs --file data/sig-inventory-live.json
 */
import fs from "fs/promises";
import path from "path";

const ROOT = process.cwd();
const DEFAULT_FILE = path.join(ROOT, "data", "sig-inventory-live.json");
const BASE_URL = (
  process.env.SIG_CATALOG_BASE_URL ||
  process.env.BASE_URL ||
  "http://43.200.177.132"
).replace(/\/$/, "");
const USER =
  process.env.SIG_CATALOG_USER ||
  process.env.USER_ID ||
  process.env.USER ||
  "finalent";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const fileArg = args.find((a) => a.startsWith("--file="))?.slice(7) ||
  (args.includes("--file") ? args[args.indexOf("--file") + 1] : null) ||
  DEFAULT_FILE;

async function loadInventory(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  const data = JSON.parse(raw);
  const inv = Array.isArray(data?.sigInventory) ? data.sigInventory : Array.isArray(data) ? data : [];
  if (inv.length === 0) throw new Error(`${filePath}: sigInventory 가 비어 있습니다`);
  return inv;
}

async function fetchCurrent() {
  const q = new URLSearchParams({ u: USER, pick: "sigInventory" });
  const res = await fetch(`${BASE_URL}/api/state?${q.toString()}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`GET 현재 상태 → HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data?.sigInventory) ? data.sigInventory : [];
}

async function postInventory(sigInventory) {
  const q = new URLSearchParams({ user: USER, u: USER });
  const res = await fetch(`${BASE_URL}/api/state?${q.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sigInventory, updatedAt: Date.now() }),
  });
  const text = await res.text();
  let body = {};
  try {
    body = text.trim() ? JSON.parse(text) : {};
  } catch {
    /* noop */
  }
  if (!res.ok) throw new Error(`POST 실패 HTTP ${res.status}: ${text.slice(0, 200)}`);
  return body;
}

async function main() {
  const filePath = path.isAbsolute(fileArg) ? fileArg : path.join(ROOT, fileArg);
  const inv = await loadInventory(filePath);
  const current = await fetchCurrent().catch(() => []);
  console.log(`[restore-sig-inventory] 파일: ${path.relative(ROOT, filePath)}`);
  console.log(`  복구 대상: ${inv.length}개 · 서버 현재: ${current.length}개`);
  if (dryRun) {
    console.log("  --dry-run: POST 생략");
    return;
  }
  if (current.length >= inv.length * 0.9 && current.length > 30) {
    console.log("  서버 목록이 이미 충분합니다. 강제 복구: CONFIRM=1 환경변수");
    if (process.env.CONFIRM !== "1") return;
  }
  const result = await postInventory(inv);
  console.log(`  저장 완료 updatedAt=${result.updatedAt ?? "?"}`);
  const after = await fetchCurrent();
  console.log(`  확인: 서버 ${after.length}개`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
