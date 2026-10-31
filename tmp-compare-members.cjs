const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const SKIP_NAMES = new Set([
  "name",
  "계좌합계",
  "투네합계",
  "합계",
  "총합",
  "총계",
  "소득세",
  "지방소득세",
  "수수료",
]);
const SKIP_AMOUNT_LABELS = new Set(["소득세", "지방소득세", "계좌합계", "투네합계", "합계", "총합", "총계"]);

function excelSerialToMs(n) {
  if (typeof n === "number" && n > 40000 && n < 60000) {
    return Math.round((n - 25569) * 86400 * 1000);
  }
  return 0;
}

function parseTime(v) {
  if (typeof v === "number") return excelSerialToMs(v);
  const s = String(v || "").trim();
  if (!s) return 0;
  const m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const iso = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}T${m[4].padStart(2, "0")}:${m[5]}:${(m[6] || "00").padStart(2, "0")}+09:00`;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t : 0;
  }
  return 0;
}

function normName(s) {
  return String(s || "")
    .replace(/\s+/g, "")
    .replace(/❤️/g, "")
    .trim()
    .toLowerCase();
}

function normMsg(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .replace(/[-–—]/g, "-")
    .trim()
    .toLowerCase();
}

function parseExcel(file) {
  const wb = XLSX.readFile(file);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
  const donations = [];
  const extras = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const c0 = r[0];
    const c1 = String(r[1] ?? "").trim();
    const c2 = r[2];
    const c3 = r[3];
    // tax rows: empty name, label in amount column
    if (SKIP_AMOUNT_LABELS.has(String(c2).trim()) && typeof c3 === "number") {
      extras.push({ kind: String(c2).trim(), amount: c3 });
      continue;
    }
    if (SKIP_NAMES.has(c1.toLowerCase()) || SKIP_NAMES.has(c1)) {
      extras.push({ kind: c1, amount: Number(c2) || 0 });
      continue;
    }
    const amt = typeof c2 === "number" ? c2 : Number(String(c2).replace(/,/g, ""));
    if (!c1 || !Number.isFinite(amt) || amt <= 0) continue;
    donations.push({
      at: parseTime(c0),
      atRaw: c0,
      name: c1,
      amount: amt,
      message: String(c3 ?? "").trim(),
    });
  }
  return { donations, extras };
}

const memberFiles = {
  오류난하루: { file: "ohryu.xlsx", settleName: "하루" },
  오하린: { file: "oharin.xlsx", settleName: "오하린" },
  다율: { file: "dayul.xlsx", settleName: "진다율" },
  나나: { file: "nana.xlsx", settleName: "나나" },
  자키: { file: "jaki.xlsx", settleName: "자키" },
  김라라: { file: "kimrara.xlsx", settleName: "김라라" },
};

const recs = JSON.parse(fs.readFileSync("C:/youtube/tmp-settle-din.json", "utf8"));
const rec = recs.find((r) => r.id === "st_1790178223693_kypb6");
const members = rec.members || [];
const donors = rec.donors || [];

function keyOf(name, amount, message) {
  return `${normName(name)}|${amount}|${normMsg(message).slice(0, 40)}`;
}

const report = {
  settlement: {
    id: rec.id,
    title: rec.title,
    createdAtKst: new Date(rec.createdAt + 9 * 3600 * 1000).toISOString().replace("Z", "+09:00"),
    donorCount: donors.length,
    totalGross: rec.totalGross,
    totalNet: rec.totalNet,
  },
  members: [],
};

for (const [excelLabel, meta] of Object.entries(memberFiles)) {
  const parsed = parseExcel(path.join("C:/youtube/tmp-member-xlsx", meta.file));
  const m = members.find((x) => x.name === meta.settleName);
  if (!m) {
    report.members.push({ excelLabel, settleName: meta.settleName, error: "정산에 멤버 없음" });
    continue;
  }
  const stDonors = donors.filter((d) => d.memberId === m.memberId);
  const excelByKey = new Map();
  for (const d of parsed.donations) {
    const k = keyOf(d.name, d.amount, d.message);
    if (!excelByKey.has(k)) excelByKey.set(k, []);
    excelByKey.get(k).push(d);
  }
  const settleByKey = new Map();
  for (const d of stDonors) {
    const k = keyOf(d.name || d.donorName, d.amount, d.message || "");
    if (!settleByKey.has(k)) settleByKey.set(k, []);
    settleByKey.get(k).push(d);
  }

  const missingInSettle = []; // in excel, not in settlement
  const extraInSettle = []; // in settlement, not in excel
  const usedSettle = new Set();

  for (const [k, list] of excelByKey) {
    const pool = settleByKey.get(k) || [];
    const take = Math.min(list.length, pool.length);
    for (let i = 0; i < take; i++) usedSettle.add(k + "#" + i);
    for (let i = take; i < list.length; i++) {
      missingInSettle.push(list[i]);
    }
  }
  for (const [k, list] of settleByKey) {
    const pool = excelByKey.get(k) || [];
    for (let i = pool.length; i < list.length; i++) {
      extraInSettle.push({
        name: list[i].name || list[i].donorName,
        amount: list[i].amount,
        message: list[i].message || "",
        target: list[i].target,
        at: list[i].at,
      });
    }
  }

  const excelSum = parsed.donations.reduce((s, d) => s + d.amount, 0);
  const settleSum = stDonors.reduce((s, d) => s + (Number(d.amount) || 0), 0);

  report.members.push({
    excelLabel,
    settleName: meta.settleName,
    memberId: m.memberId,
    excelCount: parsed.donations.length,
    excelSum,
    settleCount: stDonors.length,
    settleAccount: m.account,
    settleToon: m.toon,
    settleGrossRaw: m.account + m.toon,
    settleSumFromDonors: settleSum,
    settleNet: m.net,
    extras: parsed.extras,
    missingCount: missingInSettle.length,
    missingSum: missingInSettle.reduce((s, d) => s + d.amount, 0),
    extraCount: extraInSettle.length,
    extraSum: extraInSettle.reduce((s, d) => s + d.amount, 0),
    missingInSettle: missingInSettle.slice(0, 40),
    extraInSettle: extraInSettle.slice(0, 40),
  });
}

fs.writeFileSync("C:/youtube/tmp-member-compare.json", JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify(report, null, 2));
