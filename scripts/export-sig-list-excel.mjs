#!/usr/bin/env node
import fs from "fs";
import path from "path";
import xlsx from "xlsx";

const root = process.cwd();
const srcPath = path.join(root, "public", "data", "local-sigs.json");
const outPath = path.join(root, "data", "sig-list-with-added.xlsx");

const raw = fs.readFileSync(srcPath, "utf8");
const payload = JSON.parse(raw);
const items = Array.isArray(payload?.items) ? payload.items : [];

const rows = items.map((item, idx) => {
  const price = Math.max(0, Math.floor(Number(item?.price) || 0));
  return {
    번호: idx + 1,
    이름: String(item?.name || ""),
    금액: price,
    표시금액: `${price.toLocaleString("ko-KR")}원`,
    ID: String(item?.id || ""),
    파일명: String(item?.file || ""),
    이미지URL: String(item?.imageUrl || ""),
    가격출처: String(item?.priceSource || ""),
  };
});

const total = rows.reduce((sum, row) => sum + row.금액, 0);
const avg = rows.length > 0 ? Math.round(total / rows.length) : 0;

const summaryRows = [
  { 항목: "시그 개수", 값: rows.length },
  { 항목: "총 금액", 값: total },
  { 항목: "평균 금액", 값: avg },
  { 항목: "생성 시각", 값: new Date().toISOString() },
  { 항목: "원본", 값: "public/data/local-sigs.json" },
];

const workbook = xlsx.utils.book_new();
const summarySheet = xlsx.utils.json_to_sheet(summaryRows);
const listSheet = xlsx.utils.json_to_sheet(rows);

xlsx.utils.book_append_sheet(workbook, summarySheet, "요약");
xlsx.utils.book_append_sheet(workbook, listSheet, "시그목록");
xlsx.writeFile(workbook, outPath);

console.log(`[sig:export-excel] saved: ${outPath}`);
console.log(`[sig:export-excel] count=${rows.length}, total=${total}`);
