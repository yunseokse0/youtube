const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const dir = "C:/youtube/tmp-member-xlsx";
const files = {
  오류난하루: "ohryu.xlsx",
  오하린: "oharin.xlsx",
  다율: "dayul.xlsx",
  나나: "nana.xlsx",
  자키: "jaki.xlsx",
  김라라: "kimrara.xlsx",
};

function inspect(file) {
  const wb = XLSX.readFile(path.join(dir, file));
  const out = { sheets: wb.SheetNames, preview: {} };
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: "" });
    out.preview[name] = {
      n: rows.length,
      head: rows.slice(0, 6),
      tail: rows.slice(-3),
    };
  }
  return out;
}

for (const [ko, f] of Object.entries(files)) {
  console.log("\n====", ko, f, "====");
  console.log(JSON.stringify(inspect(f), null, 2));
}
