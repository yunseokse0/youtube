// 자키생일 정산 donors.at 필드만 엑셀 파일 기준으로 복구하기 — 파싱 스크립트 (Node)
// 출력: C:\Users\DIN-STUDIO\Projects\youtube\tmp-birthday-at-map.json
//   key = `${name}\u0001${amount}\u0001${message}` → value = { atMs, rowIndex, rawTime }
// 사용: node tmp-fix-birthday-at-from-xlsx.mjs

import { createRequire } from "module";
import { writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
const __dirname = dirname(fileURLToPath(import.meta.url));

const XLSX_PATH = "C:/Users/DIN-STUDIO/Downloads/자키 생일 후원리스트.xlsx";
const OUT_PATH = join(__dirname, "tmp-birthday-at-map.json");

if (!existsSync(XLSX_PATH)) {
  console.error("엑셀 파일 없음:", XLSX_PATH);
  process.exit(1);
}

// state.ts:parseKstLocalTimestampToMs 와 동일 로직
function parseKstLocalTimestampToMs(input) {
  if (typeof input === "number") {
    return Number.isFinite(input) && input > 1_000_000_000_000 ? input : NaN;
  }
  const raw = String(input || "").trim();
  if (!raw) return NaN;
  if (/[Zz]$|[+\-]\d{2}:?\d{2}$/.test(raw)) {
    const t = Date.parse(raw);
    return Number.isFinite(t) ? t : NaN;
  }
  const m = raw.match(
    /(\d{4})\D+(\d{1,2})\D+(\d{1,2})\D+(\d{1,2})\D+(\d{1,2})(?:\D+(\d{1,2}))?/
  );
  if (!m) {
    const t = Date.parse(raw);
    return Number.isFinite(t) ? t : NaN;
  }
  let year = Number(m[1]);
  let month = Number(m[2]) - 1;
  let day = Number(m[3]);
  let hours = Number(m[4]);
  const minutes = Number(m[5]);
  const seconds = m[6] !== undefined ? Number(m[6]) : 0;
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(seconds)
  ) {
    return NaN;
  }
  if (hours >= 24) {
    const extraDays = Math.floor(hours / 24);
    hours = hours % 24;
    day += extraDays;
  }
  const t = Date.UTC(year, month, day, hours - 9, minutes, seconds, 0);
  return Number.isFinite(t) ? t : NaN;
}

function formatKst(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  const kr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const pick = (t) => kr.find((p) => p.type === t)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")} ${pick("hour")}:${pick("minute")}:${pick("second")}`;
}

const workbook = XLSX.readFile(XLSX_PATH);
const sheetName = workbook.SheetNames[0];
const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });

console.log(`[1/3] 엑셀 로드 완료: 시트명=${sheetName}, 행수=${rows.length}`);

const headers = Object.keys(rows[0] || {});
const TIME_IDX = 0;
const NAME_IDX = 1;
const AMOUNT_IDX = 2;
const MEMO_IDX = 3;

const atMap = {};
const dups = [];
const parseFail = [];
let minAt = Infinity, maxAt = -Infinity;

for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  const vals = Object.values(r);
  const rawTime = String(vals[TIME_IDX] ?? "").trim();
  const name = String(vals[NAME_IDX] ?? "").replace(/\s+/g, "").trim() || "무명";
  const amount = Math.max(0, Math.round(Number(vals[AMOUNT_IDX]) || 0));
  const message = String(vals[MEMO_IDX] ?? "").trim();
  const atMs = parseKstLocalTimestampToMs(rawTime);

  if (!Number.isFinite(atMs) || atMs <= 0) {
    parseFail.push({ rowIndex: i, rawTime, name, amount, message });
    continue;
  }
  minAt = Math.min(minAt, atMs);
  maxAt = Math.max(maxAt, atMs);

  const key = `${name}\u0001${amount}\u0001${message}`;
  if (Object.prototype.hasOwnProperty.call(atMap, key)) {
    dups.push({
      key,
      firstRow: atMap[key].rowIndex,
      firstTime: atMap[key].rawTime,
      dupRow: i,
      dupTime: rawTime,
    });
    // 중복 시 더 이른 시각을 우선하되 로그만 남김
    if (atMs < atMap[key].atMs) atMap[key] = { atMs, rowIndex: i, rawTime };
  } else {
    atMap[key] = { atMs, rowIndex: i, rawTime };
  }
}

const sampleKeys = Object.keys(atMap).slice(0, 12).map((k) => {
  const v = atMap[k];
  const [n, a, m] = k.split("\u0001");
  return {
    key: k,
    name: n,
    amount: Number(a),
    message: m,
    rawTime: v.rawTime,
    atMs: v.atMs,
    kstOut: formatKst(v.atMs),
  };
});

writeFileSync(OUT_PATH, JSON.stringify({
  generatedAt: Date.now(),
  sourceXlsx: XLSX_PATH,
  totalRows: rows.length,
  parsedEntries: Object.keys(atMap).length,
  duplicatesCount: dups.length,
  parseFailuresCount: parseFail.length,
  rangeKst: {
    min: formatKst(minAt),
    max: formatKst(maxAt),
  },
  atMap,
  duplicatesList: dups,
  parseFailuresList: parseFail,
  sampleFirst12: sampleKeys,
}, null, 2), "utf-8");

console.log(`[2/3] 파싱 완료: 총 ${rows.length}행 → 유효맵 ${Object.keys(atMap).length}건`);
console.log(`      범위 KST: ${formatKst(minAt)} ~ ${formatKst(maxAt)}`);
console.log(`      중복 키: ${dups.length}건 (중복은 이른 시각 우선 보존)`);
console.log(`      파싱 실패: ${parseFail.length}건`);
console.log(`[3/3] JSON 덤프 → ${OUT_PATH}`);
console.log("\n[샘플 10건 spot check]");
for (const s of sampleKeys.slice(0, 10)) {
  const mShort = s.message.length > 30 ? s.message.slice(0, 30) + "…" : s.message;
  console.log(
    `  [${String(s.rowIndex).padStart(3)}] ${s.rawTime.padEnd(22)} → KST ${s.kstOut}  |  ${s.name.padEnd(10)} ${String(s.amount).padStart(8)}원  |  ${mShort}`
  );
}
if (dups.length) {
  console.log("\n[중복 키 샘플 5건]");
  for (const d of dups.slice(0, 5)) {
    console.log(`  row${d.firstRow}(${d.firstTime}) ↔ row${d.dupRow}(${d.dupTime})  key=${d.key.split("\u0001").join(" / ")}`);
  }
}
if (parseFail.length) {
  console.log("\n[파싱 실패 샘플]");
  for (const f of parseFail.slice(0, 5)) console.log(" ", f);
}
console.log("\n✅ 완료 — 이제 브라우저 콘솔 snippet 으로 정산 donors.at 만 복구하세요.");
