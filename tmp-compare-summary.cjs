const r = require("./tmp-member-compare.json");
console.log("title", r.settlement.title, "donors", r.settlement.donorCount);
for (const m of r.members) {
  console.log(
    [
      m.excelLabel,
      "->",
      m.settleName,
      "xlsx",
      m.excelCount,
      m.excelSum,
      "settleDonors",
      m.settleCount,
      m.settleSumFromDonors,
      "acc",
      m.settleAccount,
      "toon",
      m.settleToon,
      "raw",
      m.settleGrossRaw,
      "missing",
      m.missingCount,
      m.missingSum,
      "extra",
      m.extraCount,
      m.extraSum,
      "delta xlsx-settle",
      m.excelSum - m.settleSumFromDonors,
    ].join("\t")
  );
}
