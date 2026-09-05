import fs from "fs";

const state = JSON.parse(fs.readFileSync("tmp-state-live.json", "utf8"));
const pdf = JSON.parse(fs.readFileSync("scripts/data/jaki-birthday-xlsx-all.json", "utf8"));
const donors = state.donors || [];
const rows = pdf.rows || pdf.donors || [];

function nick(n) {
  return String(n || "")
    .replace(/\s+/g, "")
    .replace(/[.,:;!?~'"`()[\]{}<>_-]+/g, "")
    .toLowerCase();
}
function key(d) {
  return `${nick(d.name || d.nick)}|${Number(d.amount)}`;
}

const counts = new Map();
for (const d of donors) {
  const k = key(d);
  counts.set(k, (counts.get(k) || 0) + 1);
}

const missing = [];
for (const r of rows) {
  const k = key(r);
  const c = counts.get(k) || 0;
  if (c > 0) counts.set(k, c - 1);
  else
    missing.push({
      nick: r.nick || r.name,
      amount: r.amount,
      atKst: r.atKst,
      snip: String(r.snip || r.message || "").slice(0, 40),
    });
}

const extra = [];
for (const [k, c] of counts) {
  if (c > 0) for (let i = 0; i < c; i++) extra.push(k);
}

console.log(
  JSON.stringify(
    {
      missingCount: missing.length,
      missingSum: missing.reduce((s, x) => s + Number(x.amount || 0), 0),
      missing,
      extraCount: extra.length,
      extra: extra.slice(0, 30),
    },
    null,
    2
  )
);
