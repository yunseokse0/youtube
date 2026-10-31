const fs = require("fs");
const recs = JSON.parse(fs.readFileSync("C:/youtube/tmp-settle-din.json", "utf8"));
const rec = recs.find((r) => r.id === "st_1790178223693_kypb6");
if (!rec) {
  console.log("NOT FOUND, ids=", recs.map((r) => r.id).slice(0, 20));
  process.exit(1);
}
const slim = {
  id: rec.id,
  title: rec.title,
  createdAt: rec.createdAt,
  createdAtKst: new Date(rec.createdAt).toISOString(),
  accountRatio: rec.accountRatio,
  toonRatio: rec.toonRatio,
  feeRate: rec.feeRate,
  totalGross: rec.totalGross,
  totalNet: rec.totalNet,
  donorCount: Array.isArray(rec.donors) ? rec.donors.length : 0,
  memberCount: (rec.members || []).length,
  members: (rec.members || []).map((m) => ({
    memberId: m.memberId,
    name: m.name,
    operating: m.operating,
    account: m.account,
    toon: m.toon,
    gross: m.gross,
    net: m.net,
    fee: m.fee,
  })),
};
if (Array.isArray(rec.donors) && rec.donors.length) {
  slim.donorSample = rec.donors.slice(0, 3);
  const byMem = {};
  for (const d of rec.donors) {
    const k = d.memberId || "?";
    if (!byMem[k]) byMem[k] = { n: 0, sum: 0, account: 0, toon: 0 };
    byMem[k].n++;
    byMem[k].sum += Number(d.amount) || 0;
    if (d.target === "toon") byMem[k].toon += Number(d.amount) || 0;
    else byMem[k].account += Number(d.amount) || 0;
  }
  slim.donorsByMemberId = byMem;
}
fs.writeFileSync("C:/youtube/tmp-settle-one.json", JSON.stringify(slim, null, 2));
console.log(JSON.stringify(slim, null, 2).slice(0, 8000));
console.log("keys", Object.keys(rec));
console.log("donors", Array.isArray(rec.donors) ? rec.donors.length : rec.donors);
