const fs = require("fs");
const recs = JSON.parse(fs.readFileSync("C:/youtube/tmp-settle-din.json", "utf8"));
const rec = recs.find((r) => r.id === "st_1790178223693_kypb6");
const donors = rec.donors || [];

function hits(pred, label) {
  const h = donors.filter(pred);
  console.log("\n==", label, h.length);
  for (const d of h) {
    console.log(
      JSON.stringify({
        name: d.name,
        amount: d.amount,
        msg: d.message,
        target: d.target,
        iso: d.at ? new Date(d.at).toISOString() : "",
        kst: d.at
          ? new Date(d.at).toLocaleString("sv-SE", { timeZone: "Asia/Seoul" })
          : "",
        memberId: d.memberId,
      })
    );
  }
}

hits((d) => /간지|민수/.test(`${d.name} ${d.message}`), "간지|민수");
hits(
  (d) => Number(d.amount) === 100000 && d.memberId === "m_1788514910671_plggw",
  "하루 100000"
);
hits(
  (d) =>
    Number(d.amount) === 100000 &&
    (d.target === "account" || !String(d.message || "").trim()),
  "account-or-empty-msg 100000"
);
hits(
  (d) =>
    Number(d.amount) === 65000 &&
    /단비|오하린 살아/.test(`${d.name} ${d.message}`),
  "65000 단비/살아"
);
hits(
  (d) =>
    Number(d.amount) === 55000 && /구름|진다율/.test(`${d.name} ${d.message}`),
  "55000 구름/진다율"
);
hits(
  (d) =>
    Number(d.amount) === 15100 &&
    /구름/.test(`${d.name} ${d.message}`) &&
    d.memberId === "m_1790061731234_e3mue",
  "진다율 15100 구름"
);

const haru = donors.filter((d) => d.memberId === "m_1788514910671_plggw");
const acc = haru.filter((d) => d.target !== "toon");
console.log(
  "\n하루 account n/sum",
  acc.length,
  acc.reduce((s, d) => s + Number(d.amount), 0)
);
console.log(
  acc.map((d) => ({
    name: d.name,
    amount: d.amount,
    msg: d.message,
    kst: new Date(d.at).toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }),
  }))
);
