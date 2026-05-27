#!/usr/bin/env node
/**
 * 관리자에서 받은 시그 가격 엑셀 → data/sig-inventory-live.json
 * 이후: npm run sig:export-catalog
 *
 *   node scripts/import-sig-prices-excel.mjs "C:\Users\...\sig-prices.xlsx"
 *   SIG_EXCEL_BASE_URL=http://3.35.3.149 node scripts/import-sig-prices-excel.mjs ./prices.xlsx
 */
import fs from "fs/promises";
import path from "path";
import XLSX from "xlsx";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "data", "sig-inventory-live.json");
const BASE_URL = (process.env.SIG_EXCEL_BASE_URL || "http://3.35.3.149").replace(/\/$/, "");

function yn(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  return s === "y" || s === "yes" || s === "true" || s === "1";
}

function readName(row) {
  return String(row.name ?? row["이름"] ?? "").trim();
}

function readId(row) {
  return String(row.id ?? row["ID"] ?? "").trim();
}

function readPrice(row) {
  const raw = row.price ?? row["가격"];
  if (raw === undefined || raw === null || String(raw).trim() === "") return 0;
  return Math.max(0, Math.floor(Number(raw) || 0));
}

function readImageUrl(row) {
  return String(row.imageUrl ?? row["이미지URL"] ?? "").trim();
}

function toSigItem(row) {
  const name = readName(row);
  if (!name) return null;
  const id = readId(row) || `excel_${name.replace(/\s+/g, "_").slice(0, 40)}`;
  return {
    id,
    name,
    price: readPrice(row),
    imageUrl: readImageUrl(row),
    memberId: "",
    maxCount: Math.max(1, Math.floor(Number(row.maxCount ?? row["최대수량"]) || 1)),
    soldCount: Math.max(0, Math.floor(Number(row.soldCount ?? row["판매수"]) || 0)),
    isActive: yn(row.isActive ?? row["판매활성"] ?? "Y"),
    isRolling: yn(row.isRolling ?? row["롤링노출"] ?? "Y"),
  };
}

async function main() {
  const fileArg = process.argv[2];
  if (!fileArg) {
    console.error("사용: node scripts/import-sig-prices-excel.mjs <엑셀경로>");
    process.exit(1);
  }
  const filePath = path.resolve(fileArg);
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet);
  const sigInventory = [];
  let skipped = 0;
  for (const row of rows) {
    const item = toSigItem(row);
    if (!item) {
      skipped += 1;
      continue;
    }
    sigInventory.push(item);
  }
  sigInventory.sort((a, b) => {
    const dp = a.price - b.price;
    if (dp !== 0) return dp;
    return a.name.localeCompare(b.name, "ko");
  });

  await fs.mkdir(path.dirname(OUT), { recursive: true });
  const payload = {
    pulledAt: new Date().toISOString(),
    source: "excel",
    sourceFile: path.basename(filePath),
    baseUrl: BASE_URL,
    user: "finalent",
    sigInventory,
  };
  await fs.writeFile(OUT, JSON.stringify(payload, null, 2), "utf8");

  const withPrice = sigInventory.filter((x) => x.price > 0).length;
  console.log(
    `[import-sig-prices-excel] ${sigInventory.length}개 (가격 있음 ${withPrice}, 스킵 ${skipped})`
  );
  console.log(`  → ${path.relative(ROOT, OUT)}`);
  console.log(`  이미지 기준: ${BASE_URL}`);
  console.log("다음: npm run sig:export-catalog");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
