import crypto from "node:crypto";
const BASE = process.env.BASE || "http://localhost:3001";
const hex = () => crypto.randomBytes(3).toString("hex");

async function seed(u) {
  await fetch(`${BASE}/api/state?u=${u}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      members: [
        { id: "m1", name: "자키", account: 0, toon: 0 },
        { id: "m2", name: "수린", account: 0, toon: 0 },
        { id: "m3", name: "신연서", account: 0, toon: 0 },
      ],
      donors: [],
      donorsReplace: true,
      donorsAuthoritative: true,
    }),
  });
}

async function apply(u, items, ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  const t0 = Date.now();
  try {
    const r = await fetch(`${BASE}/api/donations/apply?u=${u}&src=x2`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items }),
      signal: c.signal,
    });
    const j = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, ms: Date.now() - t0, j };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, err: e.name };
  } finally {
    clearTimeout(t);
  }
}

function items(n, p) {
  const t0 = Date.now();
  return Array.from({ length: n }, (_, i) => ({
    id: `bank:stress-x2-${p}-${t0}-${i}-${hex()}`,
    donorKey: `dk2-${p}-${i}-${hex()}`,
    donorName: `닉${i % 23}`,
    amount: 1000 + (i % 20) * 100,
    memberId: `m${(i % 3) + 1}`,
    target: i % 2 ? "account" : "toon",
    message: "x",
    at: t0 + i,
  }));
}

async function state(u) {
  const r = await fetch(`${BASE}/api/state?u=${u}&t=${Date.now()}`);
  const j = await r.json();
  return j.state || j;
}

async function waveA(n) {
  const u = `xcliff-${Date.now()}-${n}`;
  await seed(u);
  const payload = items(n, "a");
  const t0 = Date.now();
  const rows = await Promise.all(payload.map((it) => apply(u, [it], 90_000)));
  const elapsed = Date.now() - t0;
  await new Promise((r) => setTimeout(r, 2000));
  const st = await state(u);
  const saved = (st.donors || []).length;
  const ok = rows.filter((r) => r.ok).length;
  const in1s = rows.filter((r) => r.ok && r.ms <= 1000).length;
  const lats = rows.map((r) => r.ms).sort((a, b) => a - b);
  const p95 = lats[Math.floor(n * 0.95)];
  const failSt = {};
  for (const r of rows.filter((x) => !x.ok)) {
    const k = String(r.status || r.err);
    failSt[k] = (failSt[k] || 0) + 1;
  }
  console.log(
    `A${n} HTTP ${ok}/${n} saved ${saved} elapsed ${elapsed}ms in1sHTTP ${in1s} p95 ${p95} fail=${JSON.stringify(failSt)}`
  );
}

console.log("cliff + 1s window");
await waveA(500);
await waveA(600);
{
  const u = `x1s-${Date.now()}`;
  await seed(u);
  const payload = items(80, "s");
  const t0 = Date.now();
  const rows = await Promise.all(payload.map((it) => apply(u, [it], 90_000)));
  const elapsed = Date.now() - t0;
  await new Promise((r) => setTimeout(r, 800));
  const st = await state(u);
  console.log(
    `80동시 완료 ${elapsed}ms saved ${(st.donors || []).length} httpIn1s ${rows.filter((r) => r.ok && r.ms <= 1000).length}`
  );
}
{
  const u = `xb2k-${Date.now()}`;
  await seed(u);
  const p2 = items(2000, "b");
  const one = await apply(u, p2, 180_000);
  await new Promise((r) => setTimeout(r, 2000));
  const st2 = await state(u);
  console.log(
    `B2000 HTTP ${one.status} ${one.ms}ms saved ${(st2.donors || []).length} applied=${Array.isArray(one.j?.applied) ? one.j.applied.length : one.j?.applied}`
  );
}
