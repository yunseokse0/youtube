/**
 * ACCOUNT+TOON 1-SEC INTERVAL STRESS (사용자 요청 시나리오)
 * - 시나리오:
 *   동일 donorName="박자키" + donorKey 매번 고유
 *   (A) 계좌 후원 100,000원 × 20건
 *   (B) 투네 후원 100,000원 × 20건
 *   => 번갈아 발송: A1→(1초)→B1→(1초)→A2→(1초)→B2 ... 총 40건 / 약 40초
 * - Acceptance Criteria (엄격 100% 기준):
 *   TC1 HTTP 200 OK = 40/40 (100%)
 *   TC2 state.donors 총 추가 건수 = 40건 (누락 0, 중복 0)
 *   TC3 target=account 건수 = 20건, target=toon 건수 = 20건 (각각 100% 1:1 매칭)
 *   TC4 donors 총액 = 4,000,000원 ( (20*10만) + (20*10만) = 400만원 정확)
 *   TC5 members 계좌총액 증분 = 2,000,000원 · 투네총액 증분 = 2,000,000원 (donors ↔ members 합계 1:1)
 *
 * 실행 (정산 리셋 포함 권장):
 *   $ node scripts/stress-accttoon-1s-40.mjs --reset
 *   $ BASE=http://localhost:3001 USER_ID=stress-a40 node scripts/stress-accttoon-1s-40.mjs --reset
 */
import crypto from "node:crypto";
import fs from "node:fs";

const BASE = process.env.BASE || "http://localhost:3001";
const DATE_TAG = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const TEST_USER = process.env.USER_ID || `stress-accttoon-40-${DATE_TAG}`;
const DO_RESET = process.argv.includes("--reset");

const ACCOUNT_COUNT = 20;
const TOON_COUNT = 20;
const COMMON_AMOUNT = 100_000;
const DONOR_NAME = "박자키";
const STAGGER_MS = 1000; // 1초 간격
const STATE_SETTLE_MS = 6_000; // 발송 종료 후 6초 대기

const LOG_PATH = process.env.LOG || `result/accttoon-1s-40-${TEST_USER}-${Date.now()}.log`;
try { fs.mkdirSync("result", { recursive: true }); } catch (_) {}
try { fs.unlinkSync(LOG_PATH); } catch (_) {}
const logRaw = (s) => { const line = String(s) + "\n"; try { fs.appendFileSync(LOG_PATH, line, "utf8"); } catch(_){} process.stdout.write(line); };
const log = (...a) => logRaw(a.map(x => { if (x == null) return ""; if (typeof x === "object") try { return JSON.stringify(x); } catch(_){ return String(x); } return String(x); }).join(" "));
process.on("uncaughtException", e => { log("[UNCAUGHT]", e?.stack || String(e)); process.exit(1); });
process.on("unhandledRejection", e => { log("[UNHANDLED]", e?.stack || String(e)); process.exit(2); });
const rnd8hex = () => { const b = Buffer.alloc(4); crypto.getRandomValues(b); return b.toString("hex"); };

const fetchWithTimeout = async (url, opts = {}, timeoutMs = 20_000) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
};

async function phase0HealthAndReset() {
  log("=".repeat(72));
  log(` ACCOUNT+TOON · 1초간격 40건 (계좌20 + 투네20) · STRESS TEST`);
  log("=".repeat(72));
  log(` Target: ${BASE}`);
  log(` User  : ${TEST_USER}`);
  log(` Reset : ${DO_RESET ? "실행 (--reset)" : "SKIP"}`);
  log(` 시나리오: ${DONOR_NAME} / 1건=${COMMON_AMOUNT.toLocaleString()}원 × 40건 = 총 ${(40*COMMON_AMOUNT).toLocaleString()}원 / ${40*STAGGER_MS/1000}초 윈도우`);
  log(`  · 계좌 후원 target="account" : ${ACCOUNT_COUNT}건 = ${(ACCOUNT_COUNT*COMMON_AMOUNT).toLocaleString()}원`);
  log(`  · 투네 후원 target="toon"    : ${TOON_COUNT}건 = ${(TOON_COUNT*COMMON_AMOUNT).toLocaleString()}원`);
  log("");

  const SKIP_HEALTH_CHECK = process.env.SKIP_HEALTH_CHECK === "1";
  let ready = false;
  for (let i = 0; i < 15; i++) {
    try {
      const s = Date.now();
      const r = await fetchWithTimeout(`${BASE}/api/health`, {}, 3500);
      const ms = Date.now() - s;
      const j = await r.json().catch(() => ({}));
      const statusOk = SKIP_HEALTH_CHECK ? (r.status >= 200 && r.status < 600) : r.ok;
      log(` [CHECK /api/health] HTTP ${r.status} ${ms}ms · ok=${j.ok} kv=${j.kvConfigured} mysql=${j.mysqlOk ?? "NA"} ${SKIP_HEALTH_CHECK ? "(SKIP_OK_BYPASS=1)" : ""}`);
      if (statusOk) { ready = true; break; }
    } catch (e) {
      log(` Wait ${i+1}/15: NET ${e?.name || ""} ${e?.message?.slice(0,80) || ""}`);
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  if (!ready) { log("[FATAL] 개발서버 health 안뜸 — npm run dev 로 기동 먼저"); process.exit(10); }

  if (DO_RESET) {
    log("");
    log(` [SETTLEMENT RESET] /api/settlement/reset 호출 (mode=keep, confirm=true) ...`);
    try {
      const r = await fetchWithTimeout(`${BASE}/api/settlement/reset?u=${encodeURIComponent(TEST_USER)}&t=${Date.now()}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "keep", userConfirmed: true, confirmPhrase: "reset stress" })
      }, 10_000);
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) log(`   [OK] 정산 리셋 완료 · donors 이전=${j.beforeDonors ?? "NA"} → 이후=${j.afterDonors ?? "NA"} · DIN허브 로그 clear=${j.hubLogsCleared ?? "NA"}`);
      else log(`   [WARN] 정산 리셋 응답 HTTP ${r.status} ok=${j.ok} err=${j.error ?? ""} (이어서 진행)`);
    } catch (e) {
      log(`   [ERROR] 정산 리셋 NET 실패: ${e?.message?.slice(0,100) || ""}`);
    }
    await new Promise(r => setTimeout(r, 800));
  }

  const st = await fetchState();
  if (!st || !Array.isArray(st.members)) { log("[FATAL] state GET 실패"); process.exit(11); }
  const donorBaseline = Number(st.donors?.length || 0);
  const members = (st.members || []).filter(m => m && String(m.id || "").trim());
  const memberAcctBase = members.reduce((a, m) => a + Number(m.account || 0), 0);
  const memberToonBase = members.reduce((a, m) => a + Number(m.toon || 0), 0);
  log("");
  log(` [baseline] donors.start = ${donorBaseline}건`);
  log(`   members 총계 account = ${memberAcctBase.toLocaleString()}  toon = ${memberToonBase.toLocaleString()}`);
  log(`   유효 members = ${members.length}명`);
  return { donorBaseline, memberAcctBase, memberToonBase, members };
}

async function fetchState() {
  const r = await fetchWithTimeout(`${BASE}/api/state?u=${encodeURIComponent(TEST_USER)}&t=${Date.now()}`, { cache: "no-store" }, 15_000);
  if (!r.ok) throw new Error("fetchState HTTP " + r.status);
  return await r.json();
}

function buildPayloads(members) {
  const items = [];
  const baseAt = Date.now();
  const defaultMember = members[0];
  const mid = defaultMember ? String(defaultMember.id) : "mem-1";

  const total = ACCOUNT_COUNT + TOON_COUNT;
  let aI = 0, tI = 0, slot = 0;
  while (aI < ACCOUNT_COUNT || tI < TOON_COUNT) {
    if (aI < ACCOUNT_COUNT) {
      const i = aI++;
      items.push({
        id: `acct-1s-${baseAt}-${String(i).padStart(2,"0")}-${rnd8hex()}`,
        donorName: DONOR_NAME, donorKey: `st-acct-${baseAt}-${i}`,
        amount: COMMON_AMOUNT, memberId: mid, target: "account",
        message: `[계좌 연타 #${i+1}] 스트레스 테스트`,
        at: baseAt + slot * STAGGER_MS,
        _delaySlot: slot++, _group: "account", _n: i,
      });
    }
    if (tI < TOON_COUNT) {
      const i = tI++;
      items.push({
        id: `toon-1s-${baseAt}-${String(i).padStart(2,"0")}-${rnd8hex()}`,
        donorName: DONOR_NAME, donorKey: `st-toon-${baseAt}-${i}`,
        amount: COMMON_AMOUNT, memberId: mid, target: "toon",
        message: `[투네 연타 #${i+1}] 스트레스 테스트`,
        at: baseAt + slot * STAGGER_MS,
        _delaySlot: slot++, _group: "toon", _n: i,
      });
    }
  }
  return items.sort((a, b) => a._delaySlot - b._delaySlot);
}

async function phase2Fire(payloads) {
  log("");
  log("=".repeat(72));
  log(` Phase 2: ${payloads.length}건 · ${STAGGER_MS}ms 간격 번갈아 발송`);
  const acct = payloads.filter(p => p._group === "account").length;
  const toon = payloads.filter(p => p._group === "toon").length;
  log(`   계좌 ${acct}건 ↔ 투네 ${toon}건 교차 발송 · 총 ${payloads.length * STAGGER_MS / 1000}초 소요 예상`);
  log("=".repeat(72));

  const started = Date.now();
  const results = [];
  for (let i = 0; i < payloads.length; i++) {
    const p = payloads[i];
    const delay = p._delaySlot * STAGGER_MS;
    const waitNeeded = Math.max(0, delay - (Date.now() - started));
    if (waitNeeded > 0) await new Promise(r => setTimeout(r, waitNeeded));
    const s = Date.now();
    try {
      const body = {
        items: [{
          id: p.id, donorName: p.donorName, amount: p.amount, memberId: p.memberId,
          target: p.target, message: p.message, at: p.at, donorKey: p.donorKey,
        }]
      };
      const resp = await fetchWithTimeout(
        `${BASE}/api/donations/apply?u=${encodeURIComponent(TEST_USER)}&src=stress_accttoon_1s_40&t=${Date.now()}`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
        20_000
      );
      const ms = Date.now() - s;
      let applied = 0;
      try {
        const j = await resp.json();
        if (j && Array.isArray(j.applied)) applied = j.applied.length;
        else if (j && typeof j.applied === "number") applied = j.applied;
        else if (j && j.ok && j.donorsCount != null) applied = 1;
      } catch (_) {}
      results.push({ idx: i, ok: resp.ok, status: resp.status, ms, applied, group: p._group, err: null });
      if ((i + 1) % 8 === 0 || i === payloads.length - 1) {
        log(`   → ${String(i+1).padStart(2," ")}/${payloads.length} 완료 · group=${p._group.padEnd(7," ")} · HTTP ${resp.status} · ${ms}ms · applied=${applied}`);
      }
    } catch (e) {
      const ms = Date.now() - s;
      results.push({ idx: i, ok: false, status: 0, ms, applied: 0, group: p._group, err: e?.message || String(e) });
      log(`   → ${String(i+1).padStart(2," ")}/${payloads.length} [FAIL!] group=${p._group} · NET ${e?.message?.slice(0,80)}`);
    }
  }

  const duration = Date.now() - started;
  log("");
  log(` [FIRE DONE] ${payloads.length}건 · 총 소요 ${Math.round(duration/1000*10)/10}초 (예상 ${payloads.length * STAGGER_MS / 1000}초)`);
  return results;
}

async function phase3Verify(base, payloads, httpResults) {
  log("");
  log("=".repeat(72));
  log(` Apply(HTTP) 결과 리포트`);
  log("=".repeat(72));
  const okN = httpResults.filter(r => r.ok).length;
  const totN = httpResults.length;
  const appliedSum = httpResults.reduce((s, r) => s + (r.applied || 0), 0);
  const acctHttpOk = httpResults.filter(r => r.group === "account" && r.ok).length;
  const toonHttpOk = httpResults.filter(r => r.group === "toon" && r.ok).length;
  const lats = httpResults.map(r => Number(r.ms) || 0).sort((a, b) => a - b);
  const pct = (p) => lats[Math.min(lats.length - 1, Math.floor(lats.length * p))];
  const avg = lats.reduce((s, v) => s + v, 0) / Math.max(1, lats.length);

  log(`  [TC1 HTTP 200 OK = 100%] ${okN === totN ? "[PASS]" : "[FAIL]"} · 계좌=${acctHttpOk}/${ACCOUNT_COUNT}  투네=${toonHttpOk}/${TOON_COUNT}  총 ${okN}/${totN}`);
  log(`       applied 합계 = ${appliedSum}건`);
  log(`       latency avg=${Math.round(avg)}ms · p50=${pct(0.5)}ms · p95=${pct(0.95)}ms · max=${lats[lats.length-1]}ms`);
  const errs = httpResults.filter(r => !r.ok).slice(0, 5);
  if (errs.length) log(`       실패: ${errs.map(r => `#${r.idx+1}(${r.group})=${r.status||"NET"}`).join(", ")}`);

  log("");
  log(` [SETTLE] state 반영 대기 ${STATE_SETTLE_MS}ms ...`);
  await new Promise(r => setTimeout(r, STATE_SETTLE_MS));
  const st = await fetchState();
  const donorsNow = (st.donors || []).filter(d => d && !d.donationExcluded && (String(d.id || d.donorKey || "").trim()));
  const membersNow = (st.members || []).filter(m => m && String(m.id || "").trim());
  const donorsAdded = Math.max(0, donorsNow.length - base.donorBaseline);
  const EXPECTED_TOTAL = ACCOUNT_COUNT + TOON_COUNT;

  log("");
  log("=".repeat(72));
  log(` 최종 검증 (baseline donors=${base.donorBaseline} → 현재 donors=${donorsNow.length})`);
  log("=".repeat(72));

  // TC2 총 건수 = 40건 (정확 100%)
  const tc2 = { ok: donorsAdded === EXPECTED_TOTAL, actual: donorsAdded, expected: EXPECTED_TOTAL };
  log(`  [TC2 donors 총 추가 건수 = ${EXPECTED_TOTAL}건 정확] ${tc2.ok?"[PASS]":"[FAIL]"} · 실제=${tc2.actual} · 기대=${tc2.expected} · 누락=${Math.max(0,tc2.expected-tc2.actual)} · 중복=${Math.max(0,tc2.actual-tc2.expected)}`);

  // TC3 target별 건수 = 계좌20 / 투네20
  let donorAcctN = 0, donorToonN = 0;
  let donorAcctGross = 0, donorToonGross = 0;
  const uniqById = new Map(), uniqByDonorKey = new Map();
  for (const d of donorsNow) {
    const tgt = (d.target || "account") === "toon" ? "toon" : "account";
    const amt = Number(d.amount || 0);
    if (tgt === "account") { donorAcctN++; donorAcctGross += amt; }
    else { donorToonN++; donorToonGross += amt; }
    if (d.id) uniqById.set(String(d.id), (uniqById.get(String(d.id)) || 0) + 1);
    if (d.donorKey) uniqByDonorKey.set(String(d.donorKey), (uniqByDonorKey.get(String(d.donorKey)) || 0) + 1);
  }
  const tc3 = { ok: donorAcctN === ACCOUNT_COUNT && donorToonN === TOON_COUNT, acct: donorAcctN, toon: donorToonN, expAcct: ACCOUNT_COUNT, expToon: TOON_COUNT };
  log(`  [TC3 target별 건수 정확] ${tc3.ok?"[PASS]":"[FAIL]"} · 계좌=${tc3.acct}/${tc3.expAcct} · 투네=${tc3.toon}/${tc3.expToon}`);

  // TC4 총액 = 4,000,000원 정확
  const expectedTotal = COMMON_AMOUNT * (ACCOUNT_COUNT + TOON_COUNT);
  const expectedAcct = COMMON_AMOUNT * ACCOUNT_COUNT;
  const expectedToon = COMMON_AMOUNT * TOON_COUNT;
  const totalActual = donorAcctGross + donorToonGross;
  const tc4 = { ok: totalActual === expectedTotal && donorAcctGross === expectedAcct && donorToonGross === expectedToon,
    totalActual, totalExpected: expectedTotal,
    acctActual: donorAcctGross, acctExpected: expectedAcct,
    toonActual: donorToonGross, toonExpected: expectedToon,
  };
  log(`  [TC4 총액 정확 (1:1 매칭)] ${tc4.ok?"[PASS]":"[FAIL]"}`);
  log(`       · donors 총계  : 계좌=${tc4.acctActual.toLocaleString()}(${tc4.acctActual===tc4.acctExpected?"OK":"NG"}) + 투네=${tc4.toonActual.toLocaleString()}(${tc4.toonActual===tc4.toonExpected?"OK":"NG"}) = 전체=${tc4.totalActual.toLocaleString()}`);
  log(`       · 기대값       : 계좌=${tc4.acctExpected.toLocaleString()} + 투네=${tc4.toonExpected.toLocaleString()} = 전체=${tc4.totalExpected.toLocaleString()}`);

  // TC5 members 증분 ↔ donors 총계 1:1 일치
  let memberAcctNow = 0, memberToonNow = 0;
  for (const m of membersNow) {
    memberAcctNow += Number(m.account || 0);
    memberToonNow += Number(m.toon || 0);
  }
  const netMemberAcct = Math.max(0, memberAcctNow - base.memberAcctBase);
  const netMemberToon = Math.max(0, memberToonNow - base.memberToonBase);
  const tc5 = {
    ok: (netMemberAcct === donorAcctGross && netMemberToon === donorToonGross),
    donorAcctGross, donorToonGross,
    netMemberAcct, netMemberToon,
  };
  log(`  [TC5 donors↔members 집계 1:1] ${tc5.ok?"[PASS]":"[FAIL]"}`);
  log(`       · account donors=${tc5.donorAcctGross.toLocaleString()}  ↔  members증분=${tc5.netMemberAcct.toLocaleString()}  (차이=${Math.abs(tc5.donorAcctGross-tc5.netMemberAcct).toLocaleString()})`);
  log(`       · toon    donors=${tc5.donorToonGross.toLocaleString()}  ↔  members증분=${tc5.netMemberToon.toLocaleString()}  (차이=${Math.abs(tc5.donorToonGross-tc5.netMemberToon).toLocaleString()})`);

  // TC6 중복 0건
  const dupIdN = [...uniqById.values()].filter(n => n > 1).length;
  const dupDkN = [...uniqByDonorKey.values()].filter(n => n > 1).length;
  const tc6 = { ok: dupIdN === 0 && dupDkN === 0, dupIdN, dupDkN };
  log(`  [TC6 중복 row 0건] ${tc6.ok?"[PASS]":"[FAIL]"} · id중복=${tc6.dupIdN}건 · donorKey중복=${tc6.dupDkN}건`);

  const passList = [
    { ok: okN === totN, name: "TC1 HTTP 200 100%" },
    { ok: tc2.ok, name: "TC2 총 건수 정확 40/40" },
    { ok: tc3.ok, name: "TC3 target별 건수 20/20 each" },
    { ok: tc4.ok, name: "TC4 총액 400만원 정확" },
    { ok: tc5.ok, name: "TC5 donors↔members 1:1" },
    { ok: tc6.ok, name: "TC6 중복 0건" },
  ];
  const passCount = passList.filter(t => t.ok).length;
  const total = passList.length;
  const finalVerdict = passCount === total;

  log("");
  log("-".repeat(72));
  log(` 최종 판정: ${finalVerdict?"✅ ALL PASS":"❌ FAIL"} (${passCount}/${total}종 통과)`);
  passList.forEach(t => log(`   ${t.ok?"[PASS]":"[FAIL]"} ${t.name}`));
  log(`   총 건수: 기대 ${EXPECTED_TOTAL}건 → 실제 ${donorsAdded}건 (100% 정확 ${tc2.ok?"OK":"NG"})`);
  log(`   중복 발생: ${tc6.ok?"없음 (양호)":`ID중복 ${tc6.dupIdN}건 / donorKey중복 ${tc6.dupDkN}건`}`);
  log(`   금액 정합성: donors총액=${totalActual.toLocaleString()} / 기대=${expectedTotal.toLocaleString()} = ${(totalActual*100/Math.max(1,expectedTotal)).toFixed(2)}%`);
  log("-".repeat(72));

  const mr = {
    ts: new Date().toISOString(), logFile: LOG_PATH,
    scenario: "acct20+toon20 1s-interval total-40",
    fireWindowSec: STAGGER_MS * EXPECTED_TOTAL / 1000,
    http: { ok: okN, fail: totN - okN, appliedSum, avgMs: Math.round(avg), p95: pct(0.95) },
    state: {
      donorsBefore: base.donorBaseline, donorsNow: donorsNow.length, donorsAdded,
      acctRows: donorAcctN, toonRows: donorToonN,
      acctGross: donorAcctGross, toonGross: donorToonGross, totalGross: totalActual,
      membersNetAcct: netMemberAcct, membersNetToon: netMemberToon,
      tc1: okN === totN, tc2, tc3, tc4, tc5, tc6,
    },
    passCount, total, finalVerdict,
  };
  log("machine-readable:");
  log(JSON.stringify(mr, null, 2));
  process.exit(finalVerdict ? 0 : 99);
}

(async () => {
  try {
    const base = await phase0HealthAndReset();
    const payloads = buildPayloads(base.members);
    const results = await phase2Fire(payloads);
    await phase3Verify(base, payloads, results);
  } catch (e) {
    log("[FATAL TOP]", e?.stack || String(e));
    process.exit(50);
  }
})();
