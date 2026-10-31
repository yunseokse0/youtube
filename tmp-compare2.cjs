const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

function excelSerialToMs(n) {
  if (typeof n === "number" && n > 40000 && n < 60000) {
    return Math.round((n - 25569) * 86400 * 1000);
  }
  return 0;
}
function parseTime(v) {
  if (typeof v === "number") return excelSerialToMs(v);
  const s = String(v || "").trim();
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
    .normalize("NFC")
    .replace(/[\s♥❤❤️♡☆★]/g, "")
    .toLowerCase();
}
function stripSigPrefix(msg) {
  const s = String(msg || "").trim();
  const i = s.indexOf(" - ");
  if (i > 0 && i < 40) return s.slice(i + 3).trim();
  return s;
}

const SKIP = /합계|소득세|지방소득세|수수료|^name$/i;

function parseExcel(file) {
  const wb = XLSX.readFile(file);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" });
  const donations = [];
  const extras = [];
  for (let i = 1; i < rows.length; i++) {
    const [c0, c1, c2, c3] = rows[i];
    const name = String(c1 ?? "").trim();
    const label2 = String(c2 ?? "").trim();
    if (SKIP.test(label2) && typeof c3 === "number") {
      extras.push({ kind: label2, amount: c3 });
      continue;
    }
    if (SKIP.test(name) && typeof c2 === "number") {
      extras.push({ kind: name, amount: c2 });
      continue;
    }
    const amt = typeof c2 === "number" ? c2 : Number(String(c2).replace(/,/g, ""));
    if (!name || !Number.isFinite(amt) || amt <= 0) continue;
    donations.push({
      at: parseTime(c0),
      name,
      amount: amt,
      message: String(c3 ?? "").trim(),
      msgCore: stripSigPrefix(c3),
    });
  }
  return { donations, extras };
}

function matchOne(ex, pool) {
  const en = normName(ex.name);
  const scored = [];
  for (let i = 0; i < pool.length; i++) {
    const d = pool[i];
    if ((Number(d.amount) || 0) !== ex.amount) continue;
    const sn = normName(d.name || d.donorName);
    const sm = String(d.message || "").trim();
    let score = 0;
    if (sn === en) score += 50;
    else if (sn && en && (sn.includes(en) || en.includes(sn))) score += 25;
    if (ex.msgCore && sm && (sm === ex.msgCore || sm.includes(ex.msgCore) || ex.msgCore.includes(sm))) score += 30;
    if (ex.at && d.at) {
      const dt = Math.abs(ex.at - d.at);
      if (dt <= 5000) score += 45;
      else if (dt <= 60000) score += 15;
      else if (dt <= 10 * 60 * 1000) score += 5;
    }
    if (score >= 45) scored.push({ i, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored[0] || null;
}

function findAnywhere(ex, donors, members) {
  const en = normName(ex.name);
  let best = null;
  for (const d of donors) {
    if ((Number(d.amount) || 0) !== ex.amount) continue;
    const sn = normName(d.name || d.donorName);
    const sm = String(d.message || "").trim();
    let score = 0;
    if (sn === en) score += 50;
    else if (sn && en && (sn.includes(en) || en.includes(sn))) score += 25;
    if (ex.msgCore && sm && (sm === ex.msgCore || sm.includes(ex.msgCore) || ex.msgCore.includes(sm))) score += 30;
    if (ex.at && d.at) {
      const dt = Math.abs(ex.at - d.at);
      if (dt <= 5000) score += 45;
      else if (dt <= 60000) score += 15;
    }
    if (score >= 45 && (!best || score > best.score)) {
      const mem = members.find((x) => x.memberId === d.memberId);
      best = { score, memberName: mem ? mem.name : d.memberId, name: d.name, target: d.target, message: sm, at: d.at };
    }
  }
  return best;
}

const memberFiles = {
  오류난하루: { file: "ohryu.xlsx", settleName: "하루" },
  오하린: { file: "oharin.xlsx", settleName: "오하린" },
  다율: { file: "dayul.xlsx", settleName: "진다율" },
  나나: { file: "nana.xlsx", settleName: "나나" },
  자키: { file: "jaki.xlsx", settleName: "자키" },
  김라라: { file: "kimrara.xlsx", settleName: "김라라" },
};

const rec = require("./tmp-settle-din.json").find((r) => r.id === "st_1790178223693_kypb6");

const out = [];
for (const [excelLabel, meta] of Object.entries(memberFiles)) {
  const parsed = parseExcel(path.join("C:/youtube/tmp-member-xlsx", meta.file));
  const m = rec.members.find((x) => x.name === meta.settleName);
  const stDonors = rec.donors.filter((d) => d.memberId === m.memberId);
  const pool = stDonors.map((d) => ({ ...d, used: false }));
  const missing = [];
  let matchedN = 0;
  let matchedSum = 0;
  for (const ex of parsed.donations) {
    const hit = matchOne(
      ex,
      pool.filter((p) => !p.used)
    );
    if (hit) {
      pool[pool.indexOf(pool.filter((p) => !p.used)[hit.i] || { used: true })];
      // remap index onto unused list
    }
  }
  // simpler unused list
  const unused = [...stDonors];
  const missing2 = [];
  for (const ex of parsed.donations) {
    const hit = matchOne(ex, unused);
    if (hit) {
      unused.splice(hit.i, 1);
      matchedN++;
      matchedSum += ex.amount;
    } else missing2.push(ex);
  }
  const extra = unused.map((d) => ({
    name: d.name,
    amount: d.amount,
    target: d.target,
    message: String(d.message || "").slice(0, 60),
    at: d.at,
  }));
  const missingTrue = [];
  const assignedOther = [];
  for (const ex of missing2) {
    const anywhere = findAnywhere(ex, rec.donors, rec.members);
    if (!anywhere) missingTrue.push(ex);
    else if (anywhere.memberName !== meta.settleName) {
      assignedOther.push({ ...ex, assignedTo: anywhere.memberName, assignedName: anywhere.name });
    }
  }
  out.push({
    excelLabel,
    settleName: meta.settleName,
    excelCount: parsed.donations.length,
    excelSum: parsed.donations.reduce((s, d) => s + d.amount, 0),
    settleCount: stDonors.length,
    settleSum: stDonors.reduce((s, d) => s + d.amount, 0),
    settleAccount: m.account,
    settleToon: m.toon,
    extras: parsed.extras,
    matchedN,
    matchedSum,
    missingN: missingTrue.length,
    missingSum: missingTrue.reduce((s, d) => s + d.amount, 0),
    otherMemberN: assignedOther.length,
    otherMemberSum: assignedOther.reduce((s, d) => s + d.amount, 0),
    extraN: extra.length,
    extraSum: extra.reduce((s, d) => s + d.amount, 0),
    missing: missingTrue.sort((a, b) => b.amount - a.amount).slice(0, 30),
    assignedOther: assignedOther.sort((a, b) => b.amount - a.amount).slice(0, 20),
    extraTop: extra.sort((a, b) => b.amount - a.amount).slice(0, 10),
  });
}

fs.writeFileSync("C:/youtube/tmp-member-compare2.json", JSON.stringify(out, null, 2), "utf8");
const lines = ["멤버\t엑셀건\t엑셀합\t정산건\t정산합\t매칭\t다른멤버배치\t다른멤버금액\t진짜누락\t누락금액"];
for (const m of out) {
  lines.push(
    [
      m.excelLabel,
      m.excelCount,
      m.excelSum,
      m.settleCount,
      m.settleSum,
      m.matchedN,
      m.otherMemberN,
      m.otherMemberSum,
      m.missingN,
      m.missingSum,
    ].join("\t")
  );
}
fs.writeFileSync("C:/youtube/tmp-compare-summary2.txt", lines.join("\n"), "utf8");
console.log(lines.join("\n"));
