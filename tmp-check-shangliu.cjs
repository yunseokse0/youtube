const url = process.argv[2] || "http://3.37.127.90/api/shangliu?u=din";
(async () => {
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json();
  const s = data.state;
  if (!s) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  const kst = (ms) =>
    new Date(ms).toLocaleString("sv-SE", { timeZone: "Asia/Seoul" });
  const members = s.members || {};
  const order = Array.isArray(s.activeOrder) ? s.activeOrder : [];
  console.log("userId", data.userId);
  console.log("updatedAt", kst(s.updatedAt));
  console.log("mode", s.mode, "board", s.boardTotalCm, "stealSeq", s.stealSeq);
  console.log("activeOrder", order.join(","));
  console.log("--- members ---");
  let occ = 0;
  for (const [id, m] of Object.entries(members)) {
    const cm = Number(m.cm) || 0;
    occ += cm;
    const seated = order.includes(id);
    console.log(`  ${seated ? "SEAT" : "OFF "} ${id} ${m.name} ${cm}cm ${m.color}`);
  }
  console.log("occupied", occ);
  console.log("--- overlay (activeOrder && cm>0) ---");
  const overlay = [];
  order.forEach((id, i) => {
    const m = members[id];
    if (!m) return;
    const cm = Number(m.cm) || 0;
    if (cm <= 0) {
      console.log(`  skip ${id} ${m.name} ${cm}`);
      return;
    }
    overlay.push({ id, name: m.name, cm });
    console.log(`  ${i + 1} ${id} ${m.name} ${cm}`);
  });
  console.log("overlayCount", overlay.length, "overlaySum", overlay.reduce((a, x) => a + x.cm, 0));
  const log = Array.isArray(s.grantLog) ? s.grantLog : [];
  console.log("--- grantLog", log.length, "---");
  log.forEach((row) => {
    console.log(`${kst(row.t)} ${String(row.kind).padEnd(6)} ${row.id} ${row.name} amt=${row.amount} | ${row.note}`);
  });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
