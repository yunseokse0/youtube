/**
 * MIXED BURST STRESS (100/500ms): 계좌 후원 + 투네 후원 혼합 동시 대량 인입
 * - 시나리오
 *   (A) 동일 donor 계좌1 + 투네1 페어 = 15명 × 2 = 30건
 *       → ID는 다르지만 donorName·memberId·at이 거의 같음 = merge 오탐 테스트
 *   (B) 랜덤 계좌 후원 35건
 *   (C) 랜덤 투네 후원 35건
 *   => 총 100건을 5ms 간격 (100×5 = 500ms) 으로 발사
 * - Acceptance Criteria (6종):
 *   TC1 총 donors 건수 90%+ 저장
 *   TC2 동일 donor 다른 target merge 오탐 0
 *   TC3 복제 row ≤2%
 *   TC4 고유 ID 히트율 80%+
 *   TC5 계좌/투네 별도 집계 정합성 95%+ (donor 총계 ↔ member 각 필드 증분)
 *   TC6 Amount 폭발 Bug (예상 ±20% 이내)
 *
 * 실행:
 *   $ npm run stress:mixed
 *   $ BASE=http://localhost:3001 USER_ID=iso-mixed01 npm run stress:mixed
 */
import crypto from "node:crypto";
import fs from "node:fs";

const BASE = process.env.BASE || "http://localhost:3001";
const DATE_TAG = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const TEST_USER = process.env.USER_ID || `stress-mixed-${DATE_TAG}`;

const SAME_PAIR_DONORS = 15;
const PAIR_AMOUNT_ACCOUNT = 55_000;
const PAIR_AMOUNT_TOON = 77_000;
const PAIR_MSG = "계좌+투네 동시후원 폭발 테스트";
const RANDOM_ACCOUNT_COUNT = 35;
const RANDOM_TOON_COUNT = 35;
const STAGGER_MS = 5;
const STATE_SETTLE_MS = 5_000;
const donorNames = [
  "집사소린", "자키", "딱기둘", "라임님도와사비", "샴푸", "오리너구리", "불닭", "밍순이",
  "치즈감자", "만복이네", "강낭콩", "몽이아빠", "수달이", "복숭아", "해피머니", "스폰지밥",
  "뚱이", "짱구", "유리", "철수", "영희", "도라에몽", "진구", "비실이", "퉁퉁이",
  "피카츄", "라이츄", "꼬부기", "파이리", "이상해씨", "냐옹이", "또치", "폴리곤",
  "메타몽", "이브이", "뮤", "뮤츠", "잠만보", "꼬링크", "고오스", "히토카게"
];
const randMsgs = [
  "화이팅!", "오늘도 최고", "재밌어요", "응원합니다", "덕분에 힘이 나요",
  "좋은 컨텐츠 감사", "항상 건강하세요", "오늘도 웃음 가득", "굿굿", "최고!",
  "오랜만에 방문", "새벽 감사", "소중한 시간", "항상 응원", "매일 봅니다", "재미있어요"
];

const LOG_PATH = process.env.LOG || `result/mixed-100x500-${TEST_USER}-${Date.now()}.log`;
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
  const TOTAL = SAME_PAIR_DONORS * 2 + RANDOM_ACCOUNT_COUNT + RANDOM_TOON_COUNT;
  log("=".repeat(72));
  log(` MIXED BURST TEST · 계좌+투네 혼합 동시 인입 · 총 ${TOTAL}건 / ${STAGGER_MS * TOTAL}ms 윈도우`);
  log("=".repeat(72));
  log(` Target: ${BASE}   User: ${TEST_USER}    Log: ${LOG_PATH}`);
  log(`  · (A) 동일 donor × (계좌1 + 투네1) 페어: ${SAME_PAIR_DONORS}명 = ${SAME_PAIR_DONORS*2}건`);
  log(`  · (B) 랜덤 계좌 후원: ${RANDOM_ACCOUNT_COUNT}건`);
  log(`  · (C) 랜덤 투네 후원: ${RANDOM_TOON_COUNT}건`);
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
  if (!ready) { log("[FATAL] 서버 health 안뜸. npm run dev 로 개발서버 기동 먼저."); process.exit(10); }

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
  const memberAcctBase = members.reduce((a, m) => a + Number(m.account || 0), 0);
  const memberToonBase = members.reduce((a, m) => a + Number(m.toon || 0), 0);
  log(` [baseline] donors.start=${donorBaseline}건`);
  log(`   member.account 총=${memberAcctBase.toLocaleString()}원  member.toon 총=${memberToonBase.toLocaleString()}원`);
  log(`   유효멤버=${members.length}명  IDs: [${members.map(m => String(m.id)).join(" | ")}]`);
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
  let slot = 0;

  for (let i = 0; i < SAME_PAIR_DONORS; i++) {
    const donorName = donorNames[i % donorNames.length];
    const m = members[i % members.length];
    const pairBaseAt = baseAt + slot;
    const pairIdSalt = `${baseAt}-${i}`;
    items.push({
      id: `pair-Acct-${pairIdSalt}-${rnd8hex()}`,
      donorName, amount: PAIR_AMOUNT_ACCOUNT, memberId: String(m.id),
      target: "account", message: `${PAIR_MSG} #${i} (계좌)`,
      at: pairBaseAt, donorKey: `pair-${i}-acct`,
      _delaySlot: slot++, _group: "A-pair-account", _donorIdx: i,
    });
    items.push({
      id: `pair-Toon-${pairIdSalt}-${rnd8hex()}`,
      donorName, amount: PAIR_AMOUNT_TOON, memberId: String(m.id),
      target: "toon", message: `${PAIR_MSG} #${i} (투네)`,
      at: pairBaseAt + 1, donorKey: `pair-${i}-toon`,
      _delaySlot: slot++, _group: "A-pair-toon", _donorIdx: i,
    });
  }

  for (let i = 0; i < RANDOM_ACCOUNT_COUNT; i++) {
    const name = donorNames[(SAME_PAIR_DONORS + i) % donorNames.length] + (i >= donorNames.length ? String(i) : "");
    const msg = randMsgs[i % randMsgs.length];
    const amt = 10_000 + (((i * 73 + 37) % 49) + 1) * 10_000;
    const m = members[(i + 2) % members.length];
    items.push({
      id: `rand-Acct-${baseAt}-i${String(i).padStart(2,"0")}-${rnd8hex()}`,
      donorName: name, amount: amt, memberId: String(m.id),
      target: "account", message: `[계좌] ${msg}`,
      at: baseAt + slot,
      _delaySlot: slot++, _group: "B-random-account", _donorIdx: -1,
    });
  }

  for (let i = 0; i < RANDOM_TOON_COUNT; i++) {
    const name = donorNames[(SAME_PAIR_DONORS + RANDOM_ACCOUNT_COUNT + i) % donorNames.length] + (i >= donorNames.length ? String(i + 500) : "");
    const msg = randMsgs[(i + 5) % randMsgs.length];
    const amt = 10_000 + (((i * 97 + 11) % 49) + 1) * 10_000;
    const m = members[(i + 1) % members.length];
    items.push({
      id: `rand-Toon-${baseAt}-i${String(i).padStart(2,"0")}-${rnd8hex()}`,
      donorName: name, amount: amt, memberId: String(m.id),
      target: "toon", message: `[투네] ${msg}`,
      at: baseAt + slot,
      _delaySlot: slot++, _group: "C-random-toon", _donorIdx: -1,
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
  log(`   계좌 후원: ${acctItems.length}건  투네 후원: ${toonItems.length}건  (혼합 발송)`);
  const pairs = payloads.filter(p => p._group.startsWith("A"));
  log(`   동일 donor 양쪽 페어: ${Math.floor(pairs.length/2)}명 × 2 = ${pairs.length}건`);
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
          `${BASE}/api/donations/apply?u=${encodeURIComponent(TEST_USER)}&src=stress_mixed&t=${Date.now()}`,
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
  log(`  [TC1 총 donors 건수 90%+] ${tc1.ok?"[PASS]":"[FAIL]"} · 저장 ${tc1.actual}/${tc1.expected} = ${tc1.acc}`);

  let pairRowsStored = 0;
  let pairMergedBug = 0;
  const pairGroupExpected = [];
  for (let i = 0; i < SAME_PAIR_DONORS; i++) {
    const donorName = donorNames[i % donorNames.length];
    const m = base.members[i % base.members.length];
    const mid = String(m.id);
    const acctRows = donorsNow.filter(d =>
      !d.donationExcluded
      && (String(d.name || d.donorName) === donorName)
      && String(d.memberId) === mid
      && (d.target || "account") === "account"
      && Number(d.amount || 0) === PAIR_AMOUNT_ACCOUNT
    ).length;
    const toonRows = donorsNow.filter(d =>
      !d.donationExcluded
      && (String(d.name || d.donorName) === donorName)
      && String(d.memberId) === mid
      && (d.target || "account") === "toon"
      && Number(d.amount || 0) === PAIR_AMOUNT_TOON
    ).length;
    pairRowsStored += acctRows + toonRows;
    if (acctRows < 1 || toonRows < 1) pairMergedBug++;
    pairGroupExpected.push({ i, donorName, mid, acctRows, toonRows });
  }
  const tc2 = { ok: pairMergedBug === 0, pairStoredOk: pairRowsStored, pairExpected: SAME_PAIR_DONORS * 2, mergedBugCount: pairMergedBug };
  log(`  [TC2 동일 donor 계좌/투네 페어 merge 오탐 0] ${tc2.ok?"[PASS]":"[FAIL]"} · 저장 ${tc2.pairStoredOk}/${tc2.pairExpected} · merge 오탐=${tc2.mergedBugCount}건`);
  if (pairMergedBug > 0) {
    const bad = pairGroupExpected.filter(x => x.acctRows < 1 || x.toonRows < 1).slice(0, 5);
    log(`      → 오탐 상세 (최대 5명): ${bad.map(x => `#${x.i} ${x.donorName} mid=${x.mid.slice(0,8)}.. acct=${x.acctRows} toon=${x.toonRows}`).join(", ")}`);
  }

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

  // TC5: 계좌/투네 별도 집계 정합성
  let donorAcctGross = 0, donorToonGross = 0;
  const donorByMemberAcct = new Map(), donorByMemberToon = new Map();
  for (const d of donorsNow) {
    if (d.donationExcluded) continue;
    const amt = Number(d.amount || 0);
    const mid = String(d.memberId || "").trim();
    const tgt = (d.target || "account") === "toon" ? "toon" : "account";
    if (tgt === "toon") {
      donorToonGross += amt;
      if (mid) donorByMemberToon.set(mid, (donorByMemberToon.get(mid) || 0) + amt);
    } else {
      donorAcctGross += amt;
      if (mid) donorByMemberAcct.set(mid, (donorByMemberAcct.get(mid) || 0) + amt);
    }
  }
  let memberAcctNow = 0, memberToonNow = 0;
  const memByAcct = new Map(), memByToon = new Map();
  for (const m of membersNow) {
    const mid = String(m.id);
    const a = Number(m.account || 0);
    const t = Number(m.toon || 0);
    memberAcctNow += a; memberToonNow += t;
    memByAcct.set(mid, a); memByToon.set(mid, t);
  }
  const netAcct = Math.max(0, memberAcctNow - base.memberAcctBase);
  const netToon = Math.max(0, memberToonNow - base.memberToonBase);
  const matchDonorVsMemberAcct = donorAcctGross > 0 || netAcct > 0
    ? (Math.min(donorAcctGross, netAcct) / Math.max(1, Math.max(donorAcctGross, netAcct)))
    : 1;
  const matchDonorVsMemberToon = donorToonGross > 0 || netToon > 0
    ? (Math.min(donorToonGross, netToon) / Math.max(1, Math.max(donorToonGross, netToon)))
    : 1;

  let perMemberOkAcct = 0, perMemberOkToon = 0, perMemberTotal = 0;
  for (const m of base.members) {
    const mid = String(m.id);
    const dAcct = donorByMemberAcct.get(mid) || 0;
    const dToon = donorByMemberToon.get(mid) || 0;
    const mAcctBase = Number(m.account || 0);
    const mToonBase = Number(m.toon || 0);
    const mAcctNet = Math.max(0, (memByAcct.get(mid) || 0) - mAcctBase);
    const mToonNet = Math.max(0, (memByToon.get(mid) || 0) - mToonBase);
    perMemberTotal++;
    if (Math.abs(dAcct - mAcctNet) <= 1) perMemberOkAcct++;
    if (Math.abs(dToon - mToonNet) <= 1) perMemberOkToon++;
  }
  const perMemberAccPct = perMemberTotal > 0 ? (100 * perMemberOkAcct / perMemberTotal) : 100;
  const perMemberToonPct = perMemberTotal > 0 ? (100 * perMemberOkToon / perMemberTotal) : 100;
  const tc5 = {
    ok: matchDonorVsMemberAcct >= 0.95 && matchDonorVsMemberToon >= 0.95 && perMemberAccPct >= 90 && perMemberToonPct >= 90,
    donorAcct: donorAcctGross, donorToon: donorToonGross,
    memberNetAcct: netAcct, memberNetToon: netToon,
    matchAcctPct: (100 * matchDonorVsMemberAcct).toFixed(1) + "%",
    matchToonPct: (100 * matchDonorVsMemberToon).toFixed(1) + "%",
    perMemberOkAcct: `${perMemberOkAcct}/${perMemberTotal} (${perMemberAccPct.toFixed(0)}%)`,
    perMemberOkToon: `${perMemberOkToon}/${perMemberTotal} (${perMemberToonPct.toFixed(0)}%)`,
  };
  log(`  [TC5 계좌/투네 별도 집계 정합성 95%+] ${tc5.ok?"[PASS]":"[FAIL]"}`);
  log(`      · donors 총계   → 계좌=${tc5.donorAcct.toLocaleString()}  투네=${tc5.donorToon.toLocaleString()}`);
  log(`      · members 증분  → 계좌=${tc5.memberNetAcct.toLocaleString()}  투네=${tc5.memberNetToon.toLocaleString()}`);
  log(`      · 일치율       → 계좌=${tc5.matchAcctPct}  투네=${tc5.matchToonPct}`);
  log(`      · 멤버별 1:1    → 계좌 ${tc5.perMemberOkAcct}  투네 ${tc5.perMemberOkToon}`);

  // TC6: Amount 폭발 Bug 검증
  const acctExpected = (SAME_PAIR_DONORS * PAIR_AMOUNT_ACCOUNT)
    + Array.from({length: RANDOM_ACCOUNT_COUNT}, (_, i) => 10_000 + (((i * 73 + 37) % 49) + 1) * 10_000).reduce((s,v)=>s+v,0);
  const toonExpected = (SAME_PAIR_DONORS * PAIR_AMOUNT_TOON)
    + Array.from({length: RANDOM_TOON_COUNT}, (_, i) => 10_000 + (((i * 97 + 11) % 49) + 1) * 10_000).reduce((s,v)=>s+v,0);
  const totalExpected = acctExpected + toonExpected;
  const totalActual = donorAcctGross + donorToonGross;
  const ratio = totalExpected > 0 ? (totalActual / totalExpected) : 1;
  const tc6 = {
    ok: ratio >= 0.8 && ratio <= 1.25,
    expected: totalExpected, actual: totalActual, ratio: (ratio * 100).toFixed(1) + "%",
  };
  log(`  [TC6 Amount 폭발 Bug 여부 (예상 ±25%)] ${tc6.ok?"[PASS]":"[FAIL]"} · 예상 ${tc6.expected.toLocaleString()} → 실제 ${tc6.actual.toLocaleString()} (${tc6.ratio})`);

  const passList = [tc1, tc2, tc3, tc4, tc5, tc6];
  const passCount = passList.filter(t => t.ok).length;
  const total = passList.length;
  const finalVerdict = passCount >= Math.ceil(total * 0.8);
  log("");
  log("-".repeat(72));
  log(` 최종 판정: ${finalVerdict?"✅ PASS":"❌ FAIL"} (${passCount}/${total}종 통과)`);
  log(`    · donors 추가 건수 정확도 ${tc1.acc}`);
  log(`    · 계좌/투네 개별 집계 정합성 acct=${tc5.matchAcctPct} toon=${tc5.matchToonPct}`);
  log(`    · Amount 폭발 배율 ${tc6.ratio} (기준 ±25%)`);
  log(`    · 500ms burst ${EXPECTED_TOTAL}건 계좌+투네 혼합 Lost Update 여부: ${finalVerdict?"없음 (양호)":"의심 (재검토 필요)"}`);
  log("-".repeat(72));
  log(`machine-readable:`);
  const mr = {
    ts: new Date().toISOString(), logFile: LOG_PATH,
    scenario: "mixed-account-toon-100-in-500ms", fireDurationMs: STAGGER_MS * EXPECTED_TOTAL, windowMs: STAGGER_MS * EXPECTED_TOTAL,
    http: {
      ok: okN, fail: totN - okN, appliedSum,
      avgMs: Math.round(avg),
      p50: pct(0.5), p90: pct(0.9), p95: pct(0.95), p99: pct(0.99), max: lats[lats.length-1],
    },
    state: { donorsBefore: base.donorBaseline, donorsNow: donorsNow.length, donorsAdded, tc1, tc2, tc3, tc4, tc5, tc6 },
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
