/**
 * BANK 10건 동시 다건이체 STRESS
 * 시나리오: 계좌 다건이체로 동시간 10건 입금 → 후원자=박자키 · 메시지="오늘 치킨 사드세요" · 금액=10,000원 · donor.id는 매번 고유 bank:{hash} 형태
 *         → apply 전 체인에서 누락(drop)되거나 save 전 final dedupe gate 에서 merge 돼서 1건만 남으면 누락 Bug 임
 * Acceptance Criteria (엄격 100% 기준):
 *   TC1 HTTP 200 OK = 10/10 (100%)
 *   TC2 state.donors 총 추가 건수 = 10건 (누락 0, 중복 0) — 🔴 핵심 TC
 *   TC3 donors 총액 = 100,000원 (10만원 x 10건 = 100만원 정확) — TC2 만큼 중요
 *   TC4 donors ↔ members 계좌총액 증분 1:1 일치 (donors gross = members.account 증가)
 *   TC5 중복 row 0건 (id중복 0 · donorKey중복 0)
 *
 * 실행:
 *   $ node scripts/stress-bank-10conc.mjs --reset
 *   $ BASE=http://localhost:3001 USER_ID=stress-bank10 node scripts/stress-bank-10conc.mjs --reset
 *   $ ROUNDS=3 node scripts/stress-bank-10conc.mjs --reset    (3라운드 연속)
 */
import crypto from "node:crypto";
import fs from "node:fs";

const BASE = process.env.BASE || "http://localhost:3001";
const DATE_TAG = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const TEST_USER = process.env.USER_ID || `stress-bank10-${DATE_TAG}`;
const DO_RESET = process.argv.includes("--reset");
const ROUNDS = Math.max(1, parseInt(process.env.ROUNDS || "1", 10));

const BANK_COUNT = 10;
const COMMON_AMOUNT = 10_000;
const DONOR_NAME = "박자키";
const COMMON_MESSAGE = "오늘 치킨 사드세요";
const PROVIDER = "bank";
const TARGET = "account";
const CONCURRENT_STAGGER_MS = 80; // 0ms / 80ms / 160ms ... 최대 720ms 간격으로 10건 Promise.all
const STATE_SETTLE_MS = 5_000;

const LOG_PATH = process.env.LOG || `result/bank-10conc-${TEST_USER}-${Date.now()}.log`;
try { fs.mkdirSync("result", { recursive: true }); } catch (_) {}
try { fs.unlinkSync(LOG_PATH); } catch (_) {}
const logRaw = (s) => { const line = String(s) + "\n"; try { fs.appendFileSync(LOG_PATH, line, "utf8"); } catch(_){} process.stdout.write(line); };
const log = (...a) => logRaw(a.map(x => { if (x == null) return ""; if (typeof x === "object") try { return JSON.stringify(x); } catch(_){ return String(x); } return String(x); }).join(" "));
process.on("uncaughtException", e => { log("[UNCAUGHT]", e?.stack || String(e)); process.exit(1); });
process.on("unhandledRejection", e => { log("[UNHANDLED]", e?.stack || String(e)); process.exit(2); });
const rnd8hex = () => { const b = Buffer.alloc(4); crypto.getRandomValues(b); return b.toString("hex"); };
const rnd16hex = () => { const b = Buffer.alloc(8); crypto.getRandomValues(b); return b.toString("hex"); };

const fetchWithTimeout = async (url, opts = {}, timeoutMs = 20_000) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
};

async function fetchState() {
  const r = await fetchWithTimeout(`${BASE}/api/state?u=${encodeURIComponent(TEST_USER)}&t=${Date.now()}`, { cache: "no-store" }, 15_000);
  if (!r.ok) throw new Error("fetchState HTTP " + r.status);
  return await r.json();
}

async function phase0HealthAndReset() {
  log("=".repeat(72));
  log(` BANK 다건이체 10건 동시 발송 STRESS · provider=${PROVIDER} · target=${TARGET}`);
  log("=".repeat(72));
  log(` Target: ${BASE}`);
  log(` User  : ${TEST_USER}`);
  log(` Reset : ${DO_RESET ? "실행 (--reset)" : "SKIP"}`);
  log(` Rounds: ${ROUNDS} 라운드 연속 실행`);
  log(` 시나리오: donorName="${DONOR_NAME}" · 금액=${COMMON_AMOUNT.toLocaleString()}원 × ${BANK_COUNT}건 · 메시지="${COMMON_MESSAGE}" (${BANK_COUNT}건 전부 완전 동일)`);
  log(`   id 매번 고유 bank:{hash16hex} 로 발급 · 10건 staggered 0~${(BANK_COUNT-1)*CONCURRENT_STAGGER_MS}ms 내 Promise.all 동시 발송`);
  log(`   기대 donors 증분 = ${BANK_COUNT}건 · 기대 gross 증분 = ${(COMMON_AMOUNT * BANK_COUNT).toLocaleString()}원`);
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
}

function buildPayloads(round, memberId) {
  const baseAt = Date.now();
  const items = [];
  for (let i = 0; i < BANK_COUNT; i++) {
    const idHex = rnd16hex();
    items.push({
      _idx: i,
      id: `bank:stress-r${round}-${idHex}`,
      donorName: DONOR_NAME,
      donorKey: `dk-stressbank-r${round}-${i}-${rnd8hex()}`,
      externalId: `bank:ext-r${round}-${i}-${rnd8hex()}`,
      amount: COMMON_AMOUNT,
      memberId,
      target: TARGET,
      provider: PROVIDER,
      message: COMMON_MESSAGE,
      at: new Date(baseAt + i * 20).toISOString(),
      _delayMs: i * CONCURRENT_STAGGER_MS,
    });
  }
  return items;
}

async function singleRound(round, baseline) {
  log("");
  log("-".repeat(72));
  log(` 🔴 ROUND ${round}/${ROUNDS} 시작 · baseline donors=${baseline.donorBaseline} · account총액=${baseline.memberAcctBase.toLocaleString()}`);
  log("-".repeat(72));

  const members = (await fetchState()).members || [];
  const defaultMember = members[0];
  const mid = defaultMember ? String(defaultMember.id) : "mem-1";

  const payloads = buildPayloads(round, mid);
  const started = Date.now();
  const promises = payloads.map((p, i) => new Promise((res) => {
    setTimeout(async () => {
      const s = Date.now();
      try {
        const body = {
          items: [{
            id: p.id, donorName: p.donorName, amount: p.amount, memberId: p.memberId,
            target: p.target, message: p.message, at: p.at, donorKey: p.donorKey,
            provider: p.provider, externalId: p.externalId,
          }]
        };
        const resp = await fetchWithTimeout(
          `${BASE}/api/donations/apply?u=${encodeURIComponent(TEST_USER)}&src=stress_bank10conc_r${round}_${i}&t=${Date.now()}`,
          { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
          20_000
        );
        const ms = Date.now() - s;
        let applied = 0;
        let isDup = false;
        let errMsg = "";
        try {
          const j = await resp.json();
          if (j && Array.isArray(j.applied)) applied = j.applied.length;
          else if (j && typeof j.applied === "number") applied = j.applied;
          else if (j && j.ok && j.donorsCount != null) applied = 1;
          if (j && j.ok === false) { isDup = /duplicate|dedupe|skip/i.test(String(j.reason || j.error || "")); errMsg = String(j.reason || j.error || "").slice(0, 120); }
        } catch (_) {}
        res({ idx: i, ok: resp.ok, status: resp.status, ms, applied, dup: isDup, err: errMsg, bodyId: p.id });
      } catch (e) {
        res({ idx: i, ok: false, status: 0, ms: Date.now() - s, applied: 0, dup: false, err: e?.message?.slice(0, 80) || String(e), bodyId: p.id });
      }
    }, p._delayMs);
  }));
  const httpResults = await Promise.all(promises);
  const duration = Date.now() - started;
  log(`   발송 완료 ${BANK_COUNT}건 · 총 소요 ${duration}ms (예상 ${(BANK_COUNT-1)*CONCURRENT_STAGGER_MS}ms)`);

  const okN = httpResults.filter(r => r.ok).length;
  const appliedSum = httpResults.reduce((s, r) => s + (r.applied || 0), 0);
  const dupN = httpResults.filter(r => r.dup).length;
  log(`   HTTP OK=${okN}/${BANK_COUNT}  applied합계=${appliedSum}건  dedupe skip(dup flag)=${dupN}건`);
  const failedRows = httpResults.filter(r => !r.ok || r.err);
  if (failedRows.length) {
    log("   실패/에러 상세 (최대5):");
    for (const f of failedRows.slice(0, 5)) {
      log(`     - #${f.idx+1} HTTP=${f.status||"NET"} applied=${f.applied} dup=${f.dup} ms=${f.ms} err=${f.err || "N/A"} id=${f.bodyId}`);
    }
  }

  log(`   state 반영 대기 ${STATE_SETTLE_MS}ms ...`);
  await new Promise(r => setTimeout(r, STATE_SETTLE_MS));
  const st = await fetchState();
  const donorsNow = (st.donors || []).filter(d => d && !d.donationExcluded && (String(d.id || d.donorKey || "").trim()));
  const membersNow = (st.members || []).filter(m => m && String(m.id || "").trim());
  const donorsAdded = Math.max(0, donorsNow.length - baseline.donorBaseline);
  const EXPECTED_TOTAL = BANK_COUNT;

  log("");
  log(`   🔍 [ROUND ${round} 최종 검증] baseline donors=${baseline.donorBaseline} → 현재=${donorsNow.length}`);

  let donorAcctGross = 0;
  const uniqById = new Map(), uniqByDonorKey = new Map();
  let msgExactMatchCount = 0;
  for (const d of donorsNow) {
    const amt = Number(d.amount || 0);
    donorAcctGross += amt;
    if (d.id) uniqById.set(String(d.id), (uniqById.get(String(d.id)) || 0) + 1);
    if (d.donorKey) uniqByDonorKey.set(String(d.donorKey), (uniqByDonorKey.get(String(d.donorKey)) || 0) + 1);
    if (String(d.message || "") === COMMON_MESSAGE && Number(d.amount) === COMMON_AMOUNT && String(d.donorName||d.name) === DONOR_NAME) {
      msgExactMatchCount++;
    }
  }
  const expectedGross = COMMON_AMOUNT * BANK_COUNT;

  let memberAcctNow = 0;
  for (const m of membersNow) memberAcctNow += Number(m.account || 0);
  const netMemberAcct = Math.max(0, memberAcctNow - baseline.memberAcctBase);

  const dupIdN = [...uniqById.values()].filter(n => n > 1).length;
  const dupDkN = [...uniqByDonorKey.values()].filter(n => n > 1).length;

  const TC = {
    tc1: { ok: okN === BANK_COUNT, label: `TC1 HTTP 200 100%`, actual: `${okN}/${BANK_COUNT}` },
    tc2: { ok: donorsAdded === EXPECTED_TOTAL, label: `🔴 TC2 donors 증분 = ${BANK_COUNT}건 (누락/중복 없음)`, actual: `실제 ${donorsAdded}건 · 누락=${Math.max(0,EXPECTED_TOTAL-donorsAdded)} · 중복=${Math.max(0,donorsAdded-EXPECTED_TOTAL)}` },
    tc3: { ok: donorAcctGross - baseline.donorAcctGrossBase === expectedGross, label: `TC3 donors 총액 = ${expectedGross.toLocaleString()}원 정확`, actual: `${(donorAcctGross-baseline.donorAcctGrossBase).toLocaleString()} / 기대 ${expectedGross.toLocaleString()}` },
    tc4: { ok: netMemberAcct === (donorAcctGross - baseline.donorAcctGrossBase), label: "TC4 donors↔members.account 1:1", actual: `members.account증분=${netMemberAcct.toLocaleString()} vs donors gross증분=${(donorAcctGross-baseline.donorAcctGrossBase).toLocaleString()}` },
    tc5: { ok: dupIdN === 0 && dupDkN === 0, label: "TC5 중복 row 0건", actual: `id중복=${dupIdN} · donorKey중복=${dupDkN}` },
    tc6: { ok: msgExactMatchCount === BANK_COUNT + baseline.exactMatchBase, label: `TC6 메시지정확일치 건수=${BANK_COUNT}건 (동일문자열 유지)`, actual: `실제 ${msgExactMatchCount - baseline.exactMatchBase}건 / 기대 ${BANK_COUNT}건` },
  };

  log("");
  const pass = Object.values(TC).every(t => t.ok);
  for (const t of Object.values(TC)) log(`     ${t.ok?"[✅ PASS]":"[❌ FAIL]"} ${t.label}  →  ${t.actual}`);
  log(`     >>>>>>>>>> ROUND ${round} 판정: ${pass ? "ALL PASS ✅" : "FAIL ❌"}`);

  return {
    round, httpResults, TC, pass,
    nextBaseline: {
      donorBaseline: donorsNow.length,
      memberAcctBase: memberAcctNow,
      donorAcctGrossBase: donorAcctGross,
      exactMatchBase: msgExactMatchCount,
    }
  };
}

async function main() {
  await phase0HealthAndReset();
  const initial = await fetchState();
  const members0 = (initial.members || []).filter(m => m && String(m.id || "").trim());
  let donorAcctGrossBase = 0, exactMatchBase = 0;
  for (const d of (initial.donors || [])) {
    if (!d || d.donationExcluded) continue;
    donorAcctGrossBase += Number(d.amount || 0);
    if (String(d.message || "") === COMMON_MESSAGE && Number(d.amount) === COMMON_AMOUNT && String(d.donorName||d.name) === DONOR_NAME) exactMatchBase++;
  }
  let baseline = {
    donorBaseline: (initial.donors || []).filter(d => d && !d.donationExcluded && String(d.id||d.donorKey||"")).length,
    memberAcctBase: members0.reduce((a,m)=>a+Number(m.account||0),0),
    donorAcctGrossBase,
    exactMatchBase,
  };

  const results = [];
  for (let r = 1; r <= ROUNDS; r++) {
    const rr = await singleRound(r, baseline);
    baseline = rr.nextBaseline;
    results.push(rr);
  }

  log("");
  log("=".repeat(72));
  log(` 최종 ${ROUNDS}라운드 종합 판정`);
  log("=".repeat(72));
  const roundPass = results.filter(r => r.pass).length;
  log(` 라운드 통과: ${roundPass}/${ROUNDS}`);
  for (const r of results) {
    log(`   R${r.round}: ${r.pass ? "✅" : "❌"} donors ${r.TC.tc2.actual} · gross ${r.TC.tc3.actual}`);
  }
  const finalAllPass = roundPass === ROUNDS;
  log(`\n ★ 최종 판정: ${finalAllPass ? "✅ 모든 라운드 통과 — 계좌 다건이체 10건 누락 Bug 없음 안전" : "❌ 누락/중복 Bug 존재 — 코드 Fix 필요"}`);
  log(` 로그파일: ${LOG_PATH}`);
  process.exit(finalAllPass ? 0 : 50);
}

main();
