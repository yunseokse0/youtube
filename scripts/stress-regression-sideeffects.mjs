/**
 * 후원 스트레스: 기존 회귀 + 사이드이펙트 + 새 패턴 (HTTP)
 * 정산 리셋 API는 스코프가 finalent로 붙을 수 있어 호출하지 않는다.
 *
 *   node scripts/stress-regression-sideeffects.mjs
 *   BASE=http://localhost:3001 USER_ID=iso-reg01 node scripts/stress-regression-sideeffects.mjs
 */
import crypto from "node:crypto";
import fs from "node:fs";

const BASE = process.env.BASE || "http://localhost:3001";
const TAG = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
const TEST_USER = process.env.USER_ID || `stress-reg-${TAG}`;
const USER_B = `${TEST_USER}-b`;
const LOG_PATH = process.env.LOG || `result/stress-reg-${TEST_USER}.log`;

fs.mkdirSync("result", { recursive: true });
const log = (...a) => {
  const line = a.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(" ") + "\n";
  fs.appendFileSync(LOG_PATH, line, "utf8");
  process.stdout.write(line);
};

const hex = () => crypto.randomBytes(4).toString("hex");
async function fetchJson(url, opts = {}, timeoutMs = 20_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal, cache: "no-store" });
    const j = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, j };
  } finally {
    clearTimeout(t);
  }
}

function membersSeed(prefix) {
  return [
    { id: `${prefix}m1`, name: "자키", account: 0, toon: 0, contribution: 0 },
    { id: `${prefix}m2`, name: "수린", account: 0, toon: 0, contribution: 0 },
    { id: `${prefix}m3`, name: "신연서", account: 0, toon: 0, contribution: 0 },
  ];
}

async function seedUser(userId, prefix) {
  return fetchJson(`${BASE}/api/state?u=${encodeURIComponent(userId)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      members: membersSeed(prefix),
      donors: [],
      donorsReplace: true,
      donorsAuthoritative: true,
    }),
  });
}

async function getState(userId) {
  const { ok, j } = await fetchJson(`${BASE}/api/state?u=${encodeURIComponent(userId)}&t=${Date.now()}`);
  if (!ok || !j) throw new Error("state GET fail");
  return j.state || j;
}

async function applyItems(userId, items) {
  return fetchJson(
    `${BASE}/api/donations/apply?u=${encodeURIComponent(userId)}&src=stress_reg&t=${Date.now()}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items }),
    }
  );
}

function verdict(name, pass, detail) {
  log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  ·  " + detail : ""}`);
  return pass;
}

(async () => {
  const results = [];
  log("=".repeat(72));
  log(`후원 스트레스 회귀 사이드이펙트 새패턴  ${BASE}  u=${TEST_USER}`);
  log("=".repeat(72));

  const health = await fetchJson(`${BASE}/api/health`);
  results.push(verdict("health (오버레이 토큰 없이)", health.ok && health.j?.ok !== false, `HTTP ${health.status}`));
  if (!health.ok) {
    log("개발서버가 없습니다. npm run dev 후 다시 실행하세요.");
    process.exit(10);
  }

  await seedUser(TEST_USER, "a");
  await seedUser(USER_B, "b");
  const st0 = await getState(TEST_USER);
  const members = (st0.members || []).filter((m) => m?.id);
  if (members.length < 3) {
    log("멤버 seed 실패", members.length);
    process.exit(11);
  }
  const mids = members.map((m) => String(m.id));

  const burstN = 40;
  const burstItems = Array.from({ length: burstN }, (_, i) => ({
    id: `reg-burst-${TAG}-${i}-${hex()}`,
    donorName: i < 12 ? "집사소린" : `닉${i}`,
    amount: 1000 + i * 100,
    memberId: mids[i % mids.length],
    target: i % 2 === 0 ? "toon" : "account",
    message: i < 12 ? "연타" : "응원",
    at: Date.now() + i,
    donorKey: `dk-${TAG}-${i}`,
  }));

  const fire = await Promise.all(burstItems.map((item, i) => new Promise((resolve) => {
    setTimeout(async () => resolve(await applyItems(TEST_USER, [item])), i * 8);
  })));
  const httpOk = fire.filter((r) => r.ok).length;
  await new Promise((r) => setTimeout(r, 2500));
  let st = await getState(TEST_USER);
  const ids = new Set(burstItems.map((x) => x.id));
  const hit = (st.donors || []).filter((d) => ids.has(d.id) || ids.has(String(d.externalId || "")));
  const hitByAmount = (st.donors || []).length;
  results.push(verdict("기존: 40건 동시 인입 누락", hitByAmount >= 36, `donors=${hitByAmount} httpOk=${httpOk}/${burstN} exactId=${hit.length}`));

  const dupFire = await Promise.all(burstItems.slice(0, 20).map((item) => applyItems(TEST_USER, [item])));
  await new Promise((r) => setTimeout(r, 1200));
  const afterDup = await getState(TEST_USER);
  const grew = (afterDup.donors || []).length - (st.donors || []).length;
  results.push(verdict("기존: 동일 id 재전송 중복 증가 없음", grew <= 1, `Δdonors=${grew} http=${dupFire.filter((r) => r.ok).length}`));
  st = afterDup;

  const pairAt = Date.now();
  const pair = [
    {
      id: `reg-pair-acct-${hex()}`,
      donorName: "집사소린",
      amount: 55_000,
      memberId: mids[0],
      target: "account",
      message: "계좌+투네",
      at: pairAt,
    },
    {
      id: `reg-pair-toon-${hex()}`,
      donorName: "집사소린",
      amount: 77_000,
      memberId: mids[0],
      target: "toon",
      message: "계좌+투네",
      at: pairAt,
    },
  ];
  await applyItems(TEST_USER, pair);
  await new Promise((r) => setTimeout(r, 800));
  st = await getState(TEST_USER);
  const pairHit = (st.donors || []).filter((d) => pair.some((p) => p.id === d.id));
  results.push(verdict("새패턴: 같은 닉 계좌+투네 동시 2줄", pairHit.length === 2, `rows=${pairHit.length}`));

  const odd = [
    { id: `reg-odd-${hex()}`, donorName: "잔돈", amount: 99, memberId: mids[1], target: "toon", message: "99", at: Date.now() },
    { id: `reg-odd2-${hex()}`, donorName: "잔돈", amount: 199, memberId: mids[1], target: "account", message: "199", at: Date.now() + 1 },
  ];
  await applyItems(TEST_USER, odd);
  await new Promise((r) => setTimeout(r, 800));
  st = await getState(TEST_USER);
  const oddHit = (st.donors || []).filter((d) => odd.some((p) => p.id === d.id));
  const stored = oddHit.reduce((a, d) => a + Number(d.amount || 0), 0);
  results.push(verdict("사이드: 99·199원 원장 금액 보존", stored === 298 && oddHit.length === 2, `stored=${stored}`));

  const donorsBeforeTheme = (st.donors || []).length;
  const theme = await fetchJson(`${BASE}/api/state?u=${encodeURIComponent(TEST_USER)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      overlayPresets: st.overlayPresets || [],
      updatedAt: Date.now(),
    }),
  });
  await new Promise((r) => setTimeout(r, 600));
  st = await getState(TEST_USER);
  results.push(verdict(
    "사이드: 테마성 POST가 후원을 비우지 않음",
    (st.donors || []).length >= donorsBeforeTheme,
    `before=${donorsBeforeTheme} after=${(st.donors || []).length} http=${theme.status}`
  ));

  const bItems = Array.from({ length: 8 }, (_, i) => ({
    id: `reg-b-${hex()}-${i}`,
    donorName: `B유저${i}`,
    amount: 3000 + i,
    memberId: `bm${(i % 3) + 1}`,
    target: "toon",
    message: "격리",
    at: Date.now() + i,
  }));
  await applyItems(USER_B, bItems);
  await new Promise((r) => setTimeout(r, 1000));
  const stA = await getState(TEST_USER);
  const stB = await getState(USER_B);
  const leakToA = (stA.donors || []).some((d) => String(d.name || d.donorName || "").startsWith("B유저"));
  const bCount = (stB.donors || []).length;
  results.push(verdict("기존: 계정 격리 A에 B닉 없음", !leakToA, `A=${(stA.donors || []).length} B=${bCount}`));
  results.push(verdict("기존: 계정 B 후원 저장", bCount >= 6, `B=${bCount}`));

  const hs = await fetchJson(`${BASE}/api/shangliu?u=${encodeURIComponent(TEST_USER)}`);
  const grantBefore = Array.isArray(hs.j?.state?.grantLog) ? hs.j.state.grantLog.length : 0;
  const grantPut = await fetchJson(`${BASE}/api/shangliu?u=${encodeURIComponent(TEST_USER)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      state: {
        mode: "individual",
        activeOrder: ["A", "B"],
        members: {
          A: { name: "자키", color: "#ff007f", cm: 200 },
          B: { name: "수린", color: "#00f3ff", cm: 200 },
        },
        stealFx: "slide",
        stealSeq: 0,
        stealDemo: false,
        boardTotalCm: 400,
        grantLog: [
          { t: Date.now(), kind: "grant", id: "A", name: "자키", amount: 10, note: "스트레스 기록" },
        ],
      },
    }),
  });
  await applyItems(TEST_USER, [{
    id: `reg-after-hs-${hex()}`,
    donorName: "영토후",
    amount: 4000,
    memberId: mids[0],
    target: "toon",
    message: "후원후영토",
    at: Date.now(),
  }]);
  await new Promise((r) => setTimeout(r, 800));
  const hs2 = await fetchJson(`${BASE}/api/shangliu?u=${encodeURIComponent(TEST_USER)}`);
  const grantAfter = Array.isArray(hs2.j?.state?.grantLog) ? hs2.j.state.grantLog.length : 0;
  results.push(verdict(
    "사이드: 후원 인입이 영토 기록을 지우지 않음",
    grantAfter >= 1 && grantPut.ok,
    `grant ${grantBefore}→${grantAfter} put=${grantPut.status}`
  ));

  const fail = results.filter((x) => !x).length;
  log("-".repeat(72));
  log(`결과  ${results.filter(Boolean).length}/${results.length} PASS  fail=${fail}`);
  log(`로그  ${LOG_PATH}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  log("[FATAL]", e?.stack || String(e));
  process.exit(2);
});
