#!/usr/bin/env node
/**
 * 자키 생일 후원리스트 xlsx → align/delete 용 JSON (전체 행)
 *
 *   node scripts/xlsx-to-birthday-pdf-json.mjs ./tmp-jaki-birthday.xlsx --out=tmp-jaki-birthday-all.json
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

function normalizeNick(raw) {
  return String(raw || "")
    .replace(/\s+/g, "")
    .replace(/[.,:;!?~'"`()[\]{}<>_-]+/g, "")
    .toLowerCase();
}

function parseListTime(t) {
  const m = String(t).match(
    /(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{1,2}):(\d{2}):(\d{2})/
  );
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  let h = +m[4];
  const mi = +m[5];
  const s = +m[6];
  /** 엑셀/PDF 관례: 24:xx = 당일 00:xx */
  if (h === 24) h = 0;
  const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:${String(s).padStart(2, "0")}+09:00`;
  return Date.parse(iso);
}

function inferTarget(row) {
  const src = String(row["출처"] || row.source || "");
  if (/계좌|푸시|push|sms|account/i.test(src) && !/투네|toona/i.test(src)) {
    return "account";
  }
  return "toon";
}

function inferSrc(row) {
  const src = String(row["출처"] || row.source || "");
  if (/투네|toona/i.test(src)) return "toonation";
  if (/푸시|push|계좌/i.test(src)) return "push";
  return String(row.source || "other");
}

function main() {
  const args = process.argv.slice(2);
  const xlsxPath = args.find((a) => !a.startsWith("--"));
  const outArg = args.find((a) => a.startsWith("--out="));
  const outPath = outArg
    ? outArg.slice("--out=".length)
    : path.resolve("tmp-jaki-birthday-all.json");
  if (!xlsxPath) {
    console.error("사용: node scripts/xlsx-to-birthday-pdf-json.mjs <xlsx> [--out=file.json]");
    process.exit(1);
  }
  const wb = XLSX.readFile(path.resolve(xlsxPath));
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  const rows = [];
  let skip = 0;
  for (const r of rawRows) {
    const at = parseListTime(r["시간"]);
    const amount = Number(r["금액"]);
    const nick = String(r["닉네임"] || "").trim();
    if (!Number.isFinite(at) || !Number.isFinite(amount) || amount <= 0 || !nick) {
      skip += 1;
      continue;
    }
    rows.push({
      at,
      atKst: new Date(at).toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }),
      nick,
      nickKey: normalizeNick(nick),
      amount,
      target: inferTarget(r),
      src: inferSrc(r),
      snip: String(r["메모"] || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80),
    });
  }
  const sum = rows.reduce((a, r) => a + r.amount, 0);
  const payload = {
    cutoff: null,
    sourceXlsx: path.resolve(xlsxPath),
    parsedAt: new Date().toISOString(),
    stats: {
      all: rows.length,
      skip,
      sum,
      man: Number((sum / 10000).toFixed(2)),
    },
    rows,
  };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(JSON.stringify({ out: outPath, ...payload.stats }, null, 2));
}

main();
