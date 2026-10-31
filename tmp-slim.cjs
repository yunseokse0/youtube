const data = require("./tmp-member-compare2.json");
function kst(ms) {
  if (!ms) return "";
  return new Date(ms + 9 * 3600000).toISOString().replace("T", " ").slice(0, 19);
}
const slim = data.map((m) => ({
  excelLabel: m.excelLabel,
  settleName: m.settleName,
  excelCount: m.excelCount,
  excelSum: m.excelSum,
  settleCount: m.settleCount,
  settleSum: m.settleSum,
  settleAccount: m.settleAccount,
  settleToon: m.settleToon,
  toonExcel: (m.extras || []).find((e) => e.kind.includes("투네이션"))?.amount,
  accountExcel: (m.extras || []).find((e) => e.kind === "계좌합계")?.amount,
  matchedN: m.matchedN,
  missingN: m.missingN,
  missingSum: m.missingSum,
  otherMemberN: m.otherMemberN,
  otherMemberSum: m.otherMemberSum,
  missing: (m.missing || []).map((d) => ({
    name: d.name,
    amount: d.amount,
    message: d.msgCore || d.message,
    at: kst(d.at),
  })),
  assignedOther: (m.assignedOther || []).map((d) => ({
    name: d.name,
    amount: d.amount,
    message: (d.msgCore || d.message || "").slice(0, 50),
    assignedTo: d.assignedTo,
    at: kst(d.at),
  })),
}));
require("fs").writeFileSync("C:/youtube/tmp-compare-slim.json", JSON.stringify(slim, null, 2), "utf8");
console.log("ok", slim.length);
