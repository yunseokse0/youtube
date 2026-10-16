/**
 * 극한 용량: 짧은 시간에 몇 건까지 장부에 남는가
 * - Strong ID `bank:stress-x-…` + unique donorKey (content-dedup 회피)
 * - 모드 A: 1건씩 동시 POST (방송 중 단건 폭주, 계정 mutex 직렬)
 * - 모드 B: 한 요청에 N건 일괄 (붙여넣기)
 * - 모드 C: 여러 계정 동시 (mutex 병렬)
 *
 *   node scripts/stress-extreme-capacity.mjs
 *   BASE=http://localhost:3001 node scripts/stress-extreme-capacity.mjs
 */
import crypto from "node:crypto";
import fs from "node:fs";

const BASE = process.env.BASE || "http://localhost:3001";
const TAG = Date.now().toString(36);
const LOG = `result/stress-extreme-${TAG}.log`;
fs.mkdirSync("result", { recursive: true });
const log = (...a) => {
  const line = a.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(" ") + "\n";
  fs.appendFileSync(LOG, line, "utf8");
  process.stdout.write(line);
};
const hex = () => crypto.randomBytes(4).toString("hex");

async function fetchJson(url, opts = {}, timeoutMs = 90_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal, cache: "no-store" });
    const j = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, j, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, status: 0, j: null, ms: Date.now() - t0, err: e?.name || String(e) };
  } finally {
    clearTimeout(t);
  }
}

function members() {
  return [
    { id: "m1", name: "자키", account: 0, toon: 0, contribution: 0 },
    { id: "m2", name: "수린", account: 0, toon: 0, contribution: 0 },
    { id: "m3", name: "신연서", account: 0, toon: 0, contribution: 0 },
  ];
}

async function seed(userId) {
  return fetchJson(`${BASE}/api/state?u=${encodeURIComponent(userId)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ members: members(), donors: [], donorsReplace: true, donorsAuthoritative: true }),
  });
}

async function getState(userId) {
  const r = await fetchJson(`${BASE}/api/state?u=${encodeURIComponent(userId)}&t=${Date.now()}`, {}, 30_000);
  return r.j?.state || r.j || {};
}

function items(n, prefix) {
  const t0 = Date.now();
  return Array.from({ length: n }, (_, i) => ({
    id: `bank:stress-x-${prefix}-${t0}-${i}-${hex()}`,
    donorKey: `dk-x-${prefix}-${t0}-${i}-${hex()}`,
    donorName: i % 7 === 0 ? "집사소린" : `닉${i % 23}`,
    amount: 1000 + (i % 50) * 100,
    memberId: `m${(i % 3) + 1}`,
    target: i % 2 === 0 ? "toon" : "account",
    message: i % 7 === 0 ? "연타극한" : `응원${i % 9}`,
    at: t0 + i,
  }));
}

async function applyBatch(userId, batch, timeoutMs) {
  return fetchJson(
    `${BASE}/api/donations/apply?u=${encodeURIComponent(userId)}&src=stress_extreme&t=${Date.now()}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: batch }),
    },
    timeoutMs
  );
}

function summarizeHttp(rows) {
  const ok = rows.filter((r) => r.ok).length;
  const fail = rows.length - ok;
  const lats = rows.map((r) => r.ms).sort((a, b) => a - b);
  const pct = (p) => lats[Math.min(lats.length - 1, Math.floor(lats.length * p))] || 0;
  const statuses = {};
  for (const r of rows) statuses[r.status || r.err || "x"] = (statuses[r.status || r.err || "x"] || 0) + 1;
  return { ok, fail, p50: pct(0.5), p95: pct(0.95), max: lats[lats.length - 1] || 0, statuses };
}

async function waitState(userId, expected, waitMs) {
  const t0 = Date.now();
  let st = { donors: [] };
  while (Date.now() - t0 < waitMs) {
    st = await getState(userId);
    const n = (st.donors || []).length;
    if (n >= expected) return { st, wait: Date.now() - t0 };
    await new Promise((r) => setTimeout(r, 400));
  }
  return { st, wait: Date.now() - t0 };
}

function score(label, n, http, saved, expectedAmt, actualAmt, elapsedMs) {
  const rate = saved / Math.max(0.001, elapsedMs / 1000);
  const rowPct = (100 * saved) / n;
  const amtOk = expectedAmt === actualAmt;
  const pass = saved >= Math.floor(n * 0.95) && amtOk;
  return {
    label, n, saved, rowPct: Number(rowPct.toFixed(1)),
    httpOk: http.ok, httpFail: http.fail, statuses: http.statuses,
    p50: http.p50, p95: http.p95, maxMs: http.max,
    expectedAmt, actualAmt, amtOk,
    elapsedMs, perSec: Number(rate.toFixed(1)), pass,
  };
}

(async () => {
  log("=".repeat(72));
  log(`극한 용량 테스트  ${BASE}  tag=${TAG}`);
  log("=".repeat(72));
  const health = await fetchJson(`${BASE}/api/health`, {}, 4000);
  if (!health.ok) {
    log("서버 없음. npm run dev 후 재실행");
    process.exit(10);
  }
  log(`health HTTP ${health.status}`);

  const waves = [];

  // A: 단건 동시 POST
  for (const n of [50, 100, 200, 400]) {
    const userId = `x1-${TAG}-${n}`;
    await seed(userId);
    const payload = items(n, `p${n}`);
    const expectedAmt = payload.reduce((s, x) => s + x.amount, 0);
    log(`\n-- A 단건×${n} 동시 POST --`);
    const t0 = Date.now();
    const httpRows = await Promise.all(payload.map((it) => applyBatch(userId, [it], 90_000)));
    const fireMs = Date.now() - t0;
    const http = summarizeHttp(httpRows);
    const { st, wait } = await waitState(userId, n, Math.min(25_000, 2000 + n * 40));
    const saved = (st.donors || []).length;
    const actualAmt = (st.donors || []).reduce((s, d) => s + Number(d.amount || 0), 0);
    const row = score(`A 단건×${n}`, n, http, saved, expectedAmt, actualAmt, fireMs);
    row.settleWaitMs = wait;
    waves.push(row);
    log(`  HTTP ${http.ok}/${n} fail=${http.fail} p50=${http.p50} p95=${http.p95} max=${http.max} statuses=${JSON.stringify(http.statuses)}`);
    log(`  장부 ${saved}/${n} (${row.rowPct}%) 금액 ${actualAmt}/${expectedAmt} 경과 ${fireMs}ms ≈ ${row.perSec}/s  ${row.pass ? "PASS" : "FAIL"}`);
  }

  // B: 일괄 1 POST
  for (const n of [100, 200, 500, 1000]) {
    const userId = `xB-${TAG}-${n}`;
    await seed(userId);
    const payload = items(n, `b${n}`);
    const expectedAmt = payload.reduce((s, x) => s + x.amount, 0);
    log(`\n-- B 일괄 1POST ×${n} --`);
    const t0 = Date.now();
    const one = await applyBatch(userId, payload, 120_000);
    const fireMs = Date.now() - t0;
    const http = summarizeHttp([one]);
    const { st, wait } = await waitState(userId, n, 15_000);
    const saved = (st.donors || []).length;
    const actualAmt = (st.donors || []).reduce((s, d) => s + Number(d.amount || 0), 0);
    const row = score(`B 일괄×${n}`, n, http, saved, expectedAmt, actualAmt, fireMs);
    row.settleWaitMs = wait;
    waves.push(row);
    log(`  HTTP ${one.status} ${one.ms}ms applied=${one.j?.applied?.length ?? one.j?.applied}`);
    log(`  장부 ${saved}/${n} (${row.rowPct}%) 금액 ${actualAmt}/${expectedAmt} 경과 ${fireMs}ms ≈ ${row.perSec}/s  ${row.pass ? "PASS" : "FAIL"}`);
  }

  // C: 4계정 × 80 단건 동시
  {
    const per = 80;
    const users = [0, 1, 2, 3].map((i) => `xC-${TAG}-u${i}`);
    for (const u of users) await seed(u);
    const packs = users.map((u, i) => ({ u, payload: items(per, `c${i}`) }));
    const expectedAmt = packs.reduce((s, p) => s + p.payload.reduce((a, x) => a + x.amount, 0), 0);
    log(`\n-- C 4계정×${per} 단건 동시 (총 ${per * 4}) --`);
    const t0 = Date.now();
    const httpRows = await Promise.all(
      packs.flatMap((p) => p.payload.map((it) => applyBatch(p.u, [it], 90_000)))
    );
    const fireMs = Date.now() - t0;
    const http = summarizeHttp(httpRows);
    let saved = 0;
    let actualAmt = 0;
    for (const u of users) {
      const { st } = await waitState(u, per, 20_000);
      saved += (st.donors || []).length;
      actualAmt += (st.donors || []).reduce((s, d) => s + Number(d.amount || 0), 0);
    }
    const row = score(`C 4계정×${per}`, per * 4, http, saved, expectedAmt, actualAmt, fireMs);
    waves.push(row);
    log(`  HTTP ${http.ok}/${per * 4} fail=${http.fail} p95=${http.p95} max=${http.max}`);
    log(`  장부 ${saved}/${per * 4} (${row.rowPct}%) 금액일치=${row.amtOk} 경과 ${fireMs}ms ≈ ${row.perSec}/s  ${row.pass ? "PASS" : "FAIL"}`);
  }

  log("\n" + "=".repeat(72));
  log("요약");
  for (const w of waves) {
    log(`  ${w.pass ? "PASS" : "FAIL"}  ${w.label.padEnd(16)}  ${w.saved}/${w.n}  ${w.rowPct}%  ${w.perSec}/s  ${w.elapsedMs}ms  amt=${w.amtOk}`);
  }

  const aPass = waves.filter((w) => w.label.startsWith("A") && w.pass).map((w) => w.n);
  const bPass = waves.filter((w) => w.label.startsWith("B") && w.pass).map((w) => w.n);
  const aMax = aPass.length ? Math.max(...aPass) : 0;
  const bMax = bPass.length ? Math.max(...bPass) : 0;
  const aBest = waves.filter((w) => w.label.startsWith("A")).sort((a, b) => b.perSec - a.perSec)[0];
  log(`\n단건 폭주 95%+ 최대: ${aMax}건 / 일괄 95%+ 최대: ${bMax}건`);
  if (aBest) log(`단건 최고 처리량: ${aBest.perSec}건/초 (${aBest.label})`);
  log(`로그 ${LOG}`);
  fs.writeFileSync(`result/stress-extreme-${TAG}.json`, JSON.stringify({ tag: TAG, waves, aMax, bMax }, null, 2));
  process.exit(waves.every((w) => w.pass) ? 0 : 1);
})().catch((e) => {
  log("[FATAL]", e?.stack || String(e));
  process.exit(2);
});
