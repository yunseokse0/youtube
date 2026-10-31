const recs = require("./tmp-settle-din.json");
const rec = recs.find((r) => r.id === "st_1790178223693_kypb6");
const jaki = rec.members.find((m) => m.name === "자키");
const donors = rec.donors.filter((d) => d.memberId === jaki.memberId);
const big = donors.filter((d) => d.amount >= 1000000);
console.log(
  "jaki big",
  big.map((d) => ({ name: d.name, amount: d.amount, target: d.target, msg: String(d.message || "").slice(0, 40) }))
);
const names = {};
for (const d of donors) {
  names[d.name] = (names[d.name] || 0) + d.amount;
}
console.log(
  "top names",
  Object.entries(names)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
);
