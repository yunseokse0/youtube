const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

function dump(file, needles) {
  const wb = XLSX.readFile(file);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
    header: 1,
    raw: true,
    defval: "",
  });
  console.log("\nFILE", path.basename(file), "rows", rows.length, "sheet", wb.SheetNames[0]);
  console.log("HEAD", JSON.stringify(rows.slice(0, 4)));
  const extras = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const s = JSON.stringify(r);
    if (needles.some((n) => s.includes(n))) {
      console.log("HIT i=" + i, r);
      console.log("  neighbors", rows.slice(Math.max(0, i - 2), i + 3));
    }
    const blob = `${r[0]} ${r[1]} ${r[2]} ${r[3]}`;
    if (/합계|소득세|수수료/.test(blob)) extras.push({ i, r });
  }
  console.log("EXTRAS", extras);
}

dump("C:/youtube/tmp-member-xlsx/ohryu.xlsx", ["간지민수"]);
dump("C:/youtube/tmp-member-xlsx/oharin.xlsx", ["단비윤 오하린 살아"]);
dump("C:/youtube/tmp-member-xlsx/dayul.xlsx", ["구름 진다율"]);

const recs = JSON.parse(fs.readFileSync("C:/youtube/tmp-settle-din.json", "utf8"));
const rec = recs.find((r) => r.id === "st_1790178223693_kypb6");
const donors = rec.donors || [];
const names = ["간지민수", "단비윤", "구름"];
for (const n of names) {
  const hits = donors.filter(
    (d) =>
      String(d.name || "").includes(n) ||
      String(d.message || "").includes(n) ||
      String(d.donorName || "").includes(n)
  );
  console.log("\nSETTLE name", n, "hits", hits.length);
  console.log(
    JSON.stringify(
      hits.slice(0, 12).map((d) => ({
        name: d.name,
        amount: d.amount,
        at: d.at,
        iso: d.at ? new Date(d.at).toISOString() : "",
        msg: d.message,
        target: d.target,
        memberId: d.memberId,
      })),
      null,
      2
    )
  );
}
const amts = [100000, 65000, 55000, 15100];
for (const a of amts) {
  const hits = donors.filter((d) => Number(d.amount) === a);
  console.log("\nSETTLE amt", a, "count", hits.length);
  for (const d of hits) {
    const iso = d.at ? new Date(d.at).toISOString() : "";
    console.log(" ", JSON.stringify(d.name), iso, "msg=" + JSON.stringify(d.message || ""), d.target, d.memberId);
  }
}
console.log("createdAt UTC", new Date(rec.createdAt).toISOString());
console.log("createdAt KST", new Date(rec.createdAt).toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }));
