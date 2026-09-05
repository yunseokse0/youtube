import fs from "fs";

const state = JSON.parse(fs.readFileSync("tmp-state-live.json", "utf8"));
const pdf = JSON.parse(fs.readFileSync("scripts/data/jaki-birthday-xlsx-all.json", "utf8"));
const donors = state.donors || [];
const rows = pdf.rows || [];

function nick(n) {
  return String(n || "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function pdfId(r) {
  return `pdf:${r.src || "toonation"}:${r.at}:${r.amount}:${r.nickKey || r.nick}`;
}

const byId = new Map(donors.map((d) => [String(d.id || ""), d]));
const used = new Set();

const missing = [];
for (const r of rows) {
  const id = pdfId(r);
  if (byId.has(id) && !used.has(id)) {
    used.add(id);
    continue;
  }
  // fallback: nick+amount+near at (rebumped at 무시)
  let hit = -1;
  for (let i = 0; i < donors.length; i++) {
    if (used.has(`i:${i}`)) continue;
    const d = donors[i];
    if (nick(d.name) !== nick(r.nick)) continue;
    if (Number(d.amount) !== Number(r.amount)) continue;
    const idHit = String(d.id || "");
    if (idHit.includes(String(r.at))) {
      hit = i;
      break;
    }
  }
  if (hit < 0) {
    for (let i = 0; i < donors.length; i++) {
      if (used.has(`i:${i}`)) continue;
      const d = donors[i];
      if (nick(d.name) !== nick(r.nick)) continue;
      if (Number(d.amount) !== Number(r.amount)) continue;
      if (used.has(String(d.id || ""))) continue;
      hit = i;
      break;
    }
  }
  if (hit >= 0) {
    used.add(`i:${hit}`);
    used.add(String(donors[hit].id || ""));
  } else {
    missing.push({
      nick: r.nick,
      amount: r.amount,
      at: r.at,
      atKst: r.atKst,
      id: pdfId(r),
      target: r.target,
      snip: String(r.snip || "").slice(0, 40),
    });
  }
}

const liveSum = donors.reduce((s, d) => s + (Number(d.amount) || 0), 0);
const pdfSum = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
console.log(
  JSON.stringify(
    {
      live: { n: donors.length, sum: liveSum },
      xlsx: { n: rows.length, sum: pdfSum },
      missingCount: missing.length,
      missingSum: missing.reduce((s, x) => s + x.amount, 0),
      missing,
    },
    null,
    2
  )
);
