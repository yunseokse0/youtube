const url = process.argv[2] || "http://3.37.127.90/api/state?u=din";
(async () => {
  const res = await fetch(url);
  const json = await res.json();
  const donors = Array.isArray(json.donors) ? json.donors : [];
  const members = Array.isArray(json.members) ? json.members : [];
  const times = donors
    .map((d) => Number(d.at) || Date.parse(String(d.at || "")) || 0)
    .filter((n) => n > 0)
    .sort((a, b) => b - a);
  const last = times[0] ? new Date(times[0]).toISOString() : null;
  const newest = donors
    .slice()
    .sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0))
    .slice(0, 3)
    .map((d) => ({
      amount: d.amount,
      target: d.target,
      at: d.at,
      hasId: Boolean(d.id),
    }));
  console.log(
    JSON.stringify({
      ok: res.ok,
      donorCount: donors.length,
      memberCount: members.length,
      memberTotals: members.map((m) => ({
        account: m.account,
        toon: m.toon,
      })),
      settlementResetAt: json.settlementResetAt || 0,
      updatedAt: json.updatedAt || 0,
      lastDonorAt: last,
      newest,
    })
  );
})().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: String(e.message || e) }));
  process.exit(1);
});
