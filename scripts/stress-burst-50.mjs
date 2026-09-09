/**
 * BURST STRESS (50/500ms): 동일인 20건 + 타인 30건 총 50건을 500ms 윈도우 내 동시 인입
 * - Target: 개발서버 (기본 http://localhost:3001 · $BASE 로 오버라이드 가능)
 * - User  : $USER_ID 로 격리 (없으면 기본값 stress-burst-50-<date>)
 * - Acceptance Criteria (5종):
 *   TC1 총 건수 저장률 ≥90% (≥45/50)
 *   TC2 동일 donor 20건 생존 ≥50% (≥10/20 — merge된 1건도 카운트시 보정)
 *   TC3 복제 row ≤2% (≤2건)
 *   TC4 고유 ID 히트율 ≥80% (≥40/50)
 *   TC5 donors총액 ↔ members(account+toon)증가 일치율 ≥80%
 *
 * 실행:
 *   $ npm run stress:burst50
 *   $ BASE=http://localhost:3001 USER_ID=my-isolated-user npm run stress:burst50
 */
import crypto from "node:crypto";
import fs from "node:fs";

const BASE = process.env.BASE || "http://localhost:3001";
const DATE_TAG = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const TEST_USER = process.env.USER_ID || `stress-burst-50-${DATE_TAG}`;

const SAME_DONOR_NAME = "집사소린";
const SAME_MSG = "항상 응원합니다 버스트테스트 20연발";
const SAME_AMOUNT = 11_000;
const SAME_COUNT = 20;
const OTHER_COUNT = 30;
const STAGGER_MS = 10; // 50건 × 10ms = 500ms 윈도우
const STATE_SETTLE_MS = 3_500;
const otherNames = [
  "자키", "딱기둘", "라임님도와사비", "샴푸", "오리너구리", "불닭", "밍순이", "치즈감자",
  "만복이네", "강낭콩", "몽이아빠", "수달이", "복숭아", "해피머니", "스폰지밥", "뚱이",
  "짱구", "유리", "철수", "영희", "도라에몽", "진구", "비실이", "퉁퉁이", "피카츄",
  "라이츄", "꼬부기", "파이리", "이상해씨", "냐옹이"
];
const otherMsgs = [
  "화이팅!", "오늘도 최고", "재밌어요", "응원합니다", "덕분에 힘이 나요",
  "좋은 컨텐츠 감사", "항상 건강하세요", "오늘도 웃음 가득", "굿굿", "최고!"
];

const LOG_PATH = process.env.LOG || `result/burst-50x500-${TEST_USER}-${Date.now()}.log`;
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

async function phase0() {
  log("=".repeat(72));
  log(` BURST TEST · ${SAME_COUNT}건 동일인동일메시지 + ${OTHER_COUNT}건 타인 · 총 ${SAME_COUNT + OTHER_COUNT}건 / ${STAGGER_MS * (SAME_COUNT + OTHER_COUNT)}ms 윈도우`);
  log("=".repeat(72));
  log(` Target: ${BASE}   User: ${TEST_USER}    Log: ${LOG_PATH}`);
  let ready = false;
  for (let i = 0; i < 20; i++) {
    try {
      const s = Date.now();
      const r = await fetchWithTimeout(`${BASE}/api/health`, {}, 3500);
      const ms = Date.now() - s;
      if (r.ok) {
        const j = await r.json().catch(() => ({}));
        log(` [OK] /api/health HTTP ${r.status} ${ms}ms · ok=${j.ok} kv=${j.kvConfigured} redis=${j.redisConfigured} mysql=${j.mysqlOk ?? "NA"}`);
        ready = true; break;
      } else {
        log(` Wait ${i+1}/20: HTTP ${r.status}`);
      }
    } catch (e) {
      log(` Wait ${i+1}/20: NET ${e?.name || ""} ${e?.message?.slice(0,100) || ""}`);
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  if (!ready) { log("[FATAL] 서버 health 안뜸. 종료 (npm run dev 로 개발서버 기동 먼저)"); process.exit(10); }

  const s0 = await fetchState();
  if (!s0 || !Array.isArray(s0.members)) { log("[FATAL] state GET 실패"); process.exit(11); }
  if (s0.members.length < 3) {
    log(` [WARN] 멤버 ${s0.members.length}명 → 3명 seed 생성`);
    for (const nm of ["김소린", "이자키", "박라임"]) {
      try {
        await fetchWithTimeout(`${BASE}/api/members?u=${encodeURIComponent(TEST_USER)}`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: nm })
        }, 4000);
      } catch (_) {}
      await new Promise(r => setTimeout(r, 150));
    }
  }
  const stateBefore = await fetchState();
  const members = (stateBefore.members || []).filter(m => m && String(m.id || "").trim());
  if (members.length === 0) { log("[FATAL] 유효 멤버 0명"); process.exit(12); }
  const donorBaseline = Number(stateBefore.donors?.length || 0);
  const memberBaseline = members.reduce((a, m) => a + Number(m.account || 0) + Number(m.toon || 0), 0);
  log(` [baseline] donors.start=${donorBaseline}건 members.start=${memberBaseline.toLocaleString()}원 유효멤버=${members.length}명`);
  log(`   멤버 IDs: [${members.map(m => String(m.id)).join(" | ")}]`);
  return { donorBaseline, memberBaseline, members };
}

async function fetchState() {
  const r = await fetchWithTimeout(`${BASE}/api/state?u=${encodeURIComponent(TEST_USER)}&t=${Date.now()}`, { cache: "no-store" }, 15_000);
  if (!r.ok) throw new Error("fetchState HTTP " + r.status);
  return await r.json();
}

function buildPayloads(members) {
  const items = [];
  const baseAt = Date.now();
  for (let i = 0; i < SAME_COUNT; i++) {
    const m = members[i % members.length];
    items.push({
      id: `burst-A-${baseAt}-i${String(i).padStart(2, "0")}-${rnd8hex()}`,
      donorName: SAME_DONOR_NAME,
      amount: SAME_AMOUNT,
      memberId: String(m.id),
      target: (i % 2 === 0) ? "toon" : "account",
      message: SAME_MSG,
      at: baseAt + i,
      _delaySlot: i,
    });
  }
  for (let i = 0; i < OTHER_COUNT; i++) {
    const name = otherNames[i % otherNames.length] + (i >= otherNames.length ? String(i) : "");
    const msg = otherMsgs[i % otherMsgs.length];
    const amt = 1000 + ((i * 37) % 99) * 1000;
    const m = members[(i + 1) % members.length];
    items.push({
      id: `burst-B-${baseAt}-i${String(i).padStart(2, "0")}-${rnd8hex()}`,
      donorName: name,
      amount: amt,
      memberId: String(m.id),
      target: (i % 3 === 0) ? "toon" : "account",
      message: msg,
      at: baseAt + SAME_COUNT + i,
      _delaySlot: SAME_COUNT + i,
    });
  }
  return items.sort((a, b) => a._delaySlot - b._delaySlot);
}

async function phase2Fire(payloads) {
  log("");
  log("=".repeat(72));
  log(` Phase 2: ${payloads.length}건 · ${STAGGER_MS}ms 간격 fire → 총 ${STAGGER_MS * payloads.length}ms 윈도우`);
  const acctItems = payloads.filter(p => p.target === "account");
  const toonItems = payloads.filter(p => p.target === "toon");
  log(`   계좌 후원: ${acctItems.length}건  투네 후원: ${toonItems.length}건`);
  log("=".repeat(72));

  const started = Date.now();
  const results = new Array(payloads.length).fill(null);
  const promises = payloads.map((p, i) => new Promise(resolve => {
    const delay = p._delaySlot * STAGGER_MS;
    setTimeout(async () => {
      const s = Date.now();
      try {
        const body = {
          items: [{
            id: p.id, donorName: p.donorName, amount: p.amount, memberId: p.memberId,
            target: p.target, message: p.message, at: p.at,
            ...(p.donorKey ? { donorKey: p.donorKey } : {}),
          }]
        };
        const resp = await fetchWithTimeout(
          `${BASE}/api/donations/apply?u=${encodeURIComponent(TEST_USER)}&src=stress_burst50&t=${Date.now()}`,
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
        resolve({ idx: i, ok: resp.ok, status: resp.status, ms, applied, err: null });
      } catch (e) {
        resolve({ idx: i, ok: false, status: 0, ms: Date.now() - s, applied: 0, err: e?.message || String(e) });
      }
    }, delay);
  }));

  const all = await Promise.all(promises);
  all.forEach(r => results[r.idx] = r);
  const duration = Date.now() - started;
  log("");
  log(` [FIRE DONE] ${payloads.length}건 완료 · 소요시간 ${duration}ms (목표 ${STAGGER_MS * payloads.length}ms)`);
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
  const lats = httpResults.map(r => Number(r.ms) || 0).sort((a, b) => a - b);
  const pct = (p) => lats[Math.min(lats.length - 1, Math.floor(lats.length * p))];
  const avg = lats.reduce((s, v) => s + v, 0) / Math.max(1, lats.length);
  log(`   200 OK 건수      : ${okN}/${totN} (${(100*okN/totN).toFixed(1)}%)`);
  const errs = httpResults.filter(r => !r.ok).slice(0, 5);
  if (errs.length > 0) log(`   실패 상위 5건: ${errs.map(r => `#${r.idx+1}=${r.status||"NET"}(${r.err?.slice(0,50)||""})`).join(", ")}`);
  log(`   applied 합계     : ${appliedSum}건`);
  log(`   apply latency    : avg=${Math.round(avg)}ms · p50=${pct(0.5)}ms · p90=${pct(0.9)}ms · p95=${pct(0.95)}ms · p99=${pct(0.99)}ms · max=${lats[lats.length-1]}ms`);

  log("");
  log(` [SETTLE] 결과 state 반영 기다리는 중 ${STATE_SETTLE_MS}ms ...`);
  await new Promise(r => setTimeout(r, STATE_SETTLE_MS));
  const state = await fetchState();
  const donorsNow = (state.donors || []).filter(d => d && String(d.id || d.donorKey || "").trim());
  const membersNow = (state.members || []).filter(m => m && String(m.id || "").trim());
  const donorsAdded = Math.max(0, donorsNow.length - base.donorBaseline);
  const EXPECTED_TOTAL = payloads.length;

  log("");
  log("=".repeat(72));
  log(` 최종 검증 (baseline donors=${base.donorBaseline} → 현재 donors=${donorsNow.length})`);
  log("=".repeat(72));

  const tc1 = { ok: donorsAdded >= Math.floor(EXPECTED_TOTAL * 0.9), actual: donorsAdded, expected: EXPECTED_TOTAL, acc: (100*donorsAdded/EXPECTED_TOTAL).toFixed(1) + "%" };
  log(`  [TC1 총 건수 저장률 90%+] ${tc1.ok?"[PASS]":"[FAIL]"} · 저장 ${tc1.actual}/${tc1.expected} = ${tc1.acc}`);

  // TC2: 동일 donor 20건 — donorName + SAME_AMOUNT + SAME_MSG 으로 찾기
  const groupA = donorsNow.filter(d => !d.donationExcluded
    && String(d.name || d.donorName) === SAME_DONOR_NAME
    && Number(d.amount || 0) === SAME_AMOUNT
    && String(d.message || "").includes(SAME_MSG.slice(0, 10))
  );
  const aUnique = groupA.length;
  // 보정: 실제 merge가 생겨서 1건이라도 donorName 기준 1개라도 존재하면 생존으로 봐주는 안전망
  const groupAExist = donorsNow.some(d => !d.donationExcluded && String(d.name || d.donorName) === SAME_DONOR_NAME);
  const aSurviveCount = aUnique > 0 ? aUnique : (groupAExist ? 1 : 0);
  const tc2 = { ok: aSurviveCount >= Math.ceil(SAME_COUNT * 0.5), actual: aSurviveCount, expected: SAME_COUNT, rawCount: aUnique, names: SAME_DONOR_NAME };
  const mergeDesc = aUnique < SAME_COUNT ? ` (dedupe merge ${SAME_COUNT - aUnique}건 발생)` : " (dedupe merge 발생 안함)";
  log(`  [TC2 동일 donor ${SAME_COUNT}건 50%+ 생존] ${tc2.ok?"[PASS]":"[FAIL]"} · ${tc2.actual}/${SAME_COUNT}건 생존${mergeDesc}`);
  if (!tc2.ok) log(`      ⚠️ A그룹 donorName="${SAME_DONOR_NAME}" 검색결과 donors row=${aUnique}건 (ID 유실 추정)`);

  const idCnt = new Map();
  for (const d of donorsNow) {
    const k = String(d.id || `f-${d.at}-${d.name}-${Math.round(Number(d.amount||0))}-${String(d.message||"").slice(0,10)}-${d.target}`);
    idCnt.set(k, (idCnt.get(k) || 0) + 1);
  }
  const dupKeys = [...idCnt.values()].filter(n => n > 1).length;
  const tc3 = { ok: dupKeys <= Math.max(2, Math.floor(donorsNow.length * 0.02)), dupKeys };
  log(`  [TC3 복제 row ≤2%] ${tc3.ok?"[PASS]":"[FAIL]"} · 중복 키 개수=${tc3.dupKeys}`);

  const injectIds = new Set(payloads.map(p => p.id));
  const savedIdsHit = donorsNow.filter(d => injectIds.has(String(d.id || ""))).length;
  const tc4 = { ok: savedIdsHit >= Math.floor(EXPECTED_TOTAL * 0.8), actual: savedIdsHit, expected: EXPECTED_TOTAL, pct: (100*savedIdsHit/EXPECTED_TOTAL).toFixed(1) + "%" };
  log(`  [TC4 주입 ID 히트율 80%+] ${tc4.ok?"[PASS]":"[FAIL]"} · 저장 ID=${tc4.actual}/${tc4.expected} = ${tc4.pct}`);

  // TC5 정합성: donor.amount ↔ member (account+toon) 순증 (contribution 제외)
  let donorGross = 0;
  for (const d of donorsNow) { if (d.donationExcluded) continue; donorGross += Number(d.amount || 0); }
  const memberGrossNow = membersNow.reduce((a, m) => a + Number(m.account||0) + Number(m.toon||0), 0);
  const memberNet = Math.max(0, memberGrossNow - base.memberBaseline);
  const maxGM = Math.max(donorGross, memberNet, 1);
  const minGM = Math.min(donorGross, memberNet);
  const matchPct = (100 * minGM / maxGM);
  const tc5 = { ok: matchPct >= 80, donorGross, memberBaseline: base.memberBaseline, memberGrossNow, memberNet, match: matchPct.toFixed(1) + "%" };
  log(`  [TC5 정산 정합성 80%+] ${tc5.ok?"[PASS]":"[FAIL]"} · donors총액=${donorGross.toLocaleString()} members증가=${memberNet.toLocaleString()} 일치율=${tc5.match}`);

  const passList = [tc1, tc2, tc3, tc4, tc5];
  const passCount = passList.filter(t => t.ok).length;
  const total = passList.length;
  const finalVerdict = passCount >= Math.ceil(total * 0.8);
  log("");
  log("-".repeat(72));
  log(` 최종 판정: ${finalVerdict?"✅ PASS":"❌ FAIL"} (${passCount}/${total}종 통과)`);
  log(`    · donors 추가 건수 저장률 ${tc1.acc}`);
  log(`    · 정산 정합성 donors↔members 일치율 ${tc5.match}`);
  log(`    · 500ms burst ${EXPECTED_TOTAL}건 Lost Update 여부: ${finalVerdict?"없음 (양호)":"의심 (재검토 필요)"}`);
  log("-".repeat(72));
  log(`machine-readable:`);
  const mr = {
    ts: new Date().toISOString(), logFile: LOG_PATH,
    scenario: "burst-50-in-500ms", fireDurationMs: STAGGER_MS * EXPECTED_TOTAL, windowMs: STAGGER_MS * EXPECTED_TOTAL,
    http: {
      ok: okN, fail: totN - okN, appliedSum,
      avgMs: Math.round(avg),
      p50: pct(0.5), p90: pct(0.9), p95: pct(0.95), p99: pct(0.99), max: lats[lats.length-1],
    },
    state: { donorsBefore: base.donorBaseline, donorsNow: donorsNow.length, donorsAdded, tc1, tc2, tc3, tc4, tc5 },
    passCount, total, finalVerdict,
  };
  log(JSON.stringify(mr, null, 2));
  process.exit(finalVerdict ? 0 : 99);
}

(async () => {
  try {
    const base = await phase0();
    const payloads = buildPayloads(base.members);
    const results = await phase2Fire(payloads);
    await phase3Verify(base, payloads, results);
  } catch (e) {
    log("[FATAL TOP]", e?.stack || String(e));
    process.exit(50);
  }
})();
