/**
 * 후원 기록 서버 전용 1ms 연사 부하 테스트
 *
 * 브라우저 렌더 없이 HTTP(REST) 또는 Overlay WebSocket 으로
 * 투네+계좌 패킷 1,000건을 1ms 간격(약 1초 창)으로 발사한다.
 * 수신 누락 · DB/KV 락 · 응답 지연(TPS, Drop Rate)을 본다.
 *
 * 이 리포 기록 경로:
 *   HTTP apply  → POST /api/donations/apply?u=   (관리자 합산과 동일, Redis/MySQL 저장)
 *   HTTP ingest → POST /api/donations/ingest?u=  (DIN 허브 B모드, Bearer TOONA_INGEST_SECRET)
 *   WEBSOCKET   → Overlay WS (기본 :8080). 송신만 되며 DB 에 후원을 쓰지 않는다.
 *
 * 실행 (axios 설치 불필요, Node 20 fetch + 기존 ws):
 *   node scripts/db_recording_test.mjs
 *   npm run stress:db-record
 *
 *   BASE=http://127.0.0.1 USER_ID=stress-db-1ms npm run stress:db-record
 *   TARGET_TYPE=WEBSOCKET WS_SERVER_URL=ws://127.0.0.1:8080 npm run stress:db-record
 *
 * EC2 (서버 로컬, 로그인 쿠키 필요 — apply):
 *   BASE=http://127.0.0.1 COOKIE='sb_user=...' USER_ID=stress-db-1ms npm run stress:db-record
 *
 * EC2 ingest (B모드 시크릿):
 *   BASE=http://127.0.0.1 HTTP_PATH=ingest TOONA_INGEST_SECRET=... USER_ID=stress-db-1ms npm run stress:db-record
 *
 * 차단 목록: din/finalent/admin + /create-accounts 생성 계정.
 * 목록에 없는 USER_ID 는 모두 허용. 차단 계정에 쏘려면 CONFIRM_LIVE=1.
 * apply 는 쿠키 계정이 우선이므로 COOKIE 의 id 도 같이 검사한다.
 */
import crypto from "node:crypto";
import fs from "node:fs";

const TARGET_TYPE = String(process.env.TARGET_TYPE || "HTTP").toUpperCase();
const BASE = String(process.env.BASE || "http://127.0.0.1:3001").replace(/\/+$/, "");
const HTTP_PATH = String(process.env.HTTP_PATH || "apply").toLowerCase(); // apply | ingest
const WS_SERVER_URL = process.env.WS_SERVER_URL || "ws://127.0.0.1:8080";
const TEST_USER = process.env.USER_ID || "stress-db-1ms";
const COOKIE = String(process.env.COOKIE || "").trim();
const INGEST_SECRET = String(process.env.TOONA_INGEST_SECRET || "").trim();
const ADMIN_ACCOUNTS_KEY = String(process.env.ADMIN_ACCOUNTS_KEY || "").trim();

const TOTAL_EVENTS = Math.max(1, parseInt(process.env.TOTAL || "1000", 10) || 1000);
const BURST_INTERVAL_MS = Math.max(0, parseInt(process.env.BURST_INTERVAL_MS || "1", 10) || 1);
const REQ_TIMEOUT_MS = Math.max(3000, parseInt(process.env.REQ_TIMEOUT_MS || "30000", 10) || 30_000);
const SETTLE_MS = Math.max(0, parseInt(process.env.SETTLE_MS || "8000", 10) || 8000);
const VERIFY_STATE = process.env.VERIFY_STATE !== "0";

const BUILTIN_LIVE_USERS = ["din", "finalent", "admin"];
const LOG_PATH = process.env.LOG || `result/db-record-1ms-${TEST_USER}-${Date.now()}.log`;

try {
  fs.mkdirSync("result", { recursive: true });
} catch {
  /* ignore */
}

const logRaw = (s) => {
  const line = String(s) + "\n";
  try {
    fs.appendFileSync(LOG_PATH, line, "utf8");
  } catch {
    /* ignore */
  }
  process.stdout.write(line);
};
const log = (...a) =>
  logRaw(
    a
      .map((x) => {
        if (x == null) return "";
        if (typeof x === "object") {
          try {
            return JSON.stringify(x);
          } catch {
            return String(x);
          }
        }
        return String(x);
      })
      .join(" ")
  );

process.on("uncaughtException", (e) => {
  log("[UNCAUGHT]", e?.stack || String(e));
  process.exit(1);
});
process.on("unhandledRejection", (e) => {
  log("[UNHANDLED]", e?.stack || String(e));
  process.exit(2);
});

function rnd8hex() {
  const b = Buffer.alloc(4);
  crypto.getRandomValues(b);
  return b.toString("hex");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = REQ_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function authHeaders(extra = {}) {
  const headers = { "content-type": "application/json", ...extra };
  if (COOKIE) headers.cookie = COOKIE;
  return headers;
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function printReport(type, success, fail, durationSec, extra = {}) {
  const total = success + fail;
  const drop = total > 0 ? ((fail / total) * 100).toFixed(2) : "0.00";
  const tps = durationSec > 0 ? (success / durationSec).toFixed(0) : "0";
  log("");
  log("==================================================");
  log(`📊 [${type} 부하 테스트 결과 리포트]`);
  log(`- 총 요청 건수: ${total} 건`);
  log(`- DB 기록/응답 성공: ${success} 건`);
  log(`- 요청 실패/타임아웃: ${fail} 건`);
  log(`- 처리 누락률(Drop Rate): ${drop} %`);
  log(`- 총 소요 시간: ${Number(durationSec).toFixed(2)} 초`);
  log(`- 평균 처리량 (TPS): ${tps} req/sec`);
  if (extra.p50 != null) {
    log(
      `- HTTP latency: avg=${extra.avg}ms · p50=${extra.p50}ms · p95=${extra.p95}ms · p99=${extra.p99}ms · max=${extra.max}ms`
    );
  }
  if (extra.statusCounts) log(`- HTTP status: ${JSON.stringify(extra.statusCounts)}`);
  if (extra.stateHit != null) {
    log(`- state 반영(주입 ID 히트): ${extra.stateHit}/${extra.expected} (${extra.stateHitPct}%)`);
  }
  log("==================================================");
  log("");
}

function parseCookieUserId(rawCookie) {
  const raw = String(rawCookie || "").trim();
  if (!raw) return null;
  let value = raw;
  const m = raw.match(/(?:^|;\s*)sb_user=([^;]+)/i);
  if (m) value = m[1];
  else if (raw.includes("=") && !raw.startsWith("{") && !raw.startsWith("%")) {
    const idx = raw.indexOf("=");
    value = raw.slice(idx + 1);
  }
  const tryDecode = (s) => {
    let out = String(s || "").trim().replace(/^"|"$/g, "");
    for (let i = 0; i < 4; i++) {
      try {
        const next = decodeURIComponent(out);
        if (next === out) break;
        out = next;
      } catch {
        break;
      }
    }
    return out;
  };
  const decoded = tryDecode(value);
  for (const cand of [decoded, value]) {
    try {
      const parsed = JSON.parse(cand);
      const id = String(parsed?.id || "").trim().toLowerCase();
      if (id) return id;
    } catch {
      /* not json */
    }
    if (/^[a-zA-Z0-9_-]{1,64}$/.test(cand)) return cand.toLowerCase();
  }
  return null;
}

async function loadCreatedAccountIds() {
  const ids = new Set();
  if (!ADMIN_ACCOUNTS_KEY) {
    log(" [accounts] ADMIN_ACCOUNTS_KEY 없음 — 생성 계정을 차단 목록에 못 넣음. din/finalent/admin 만 차단.");
    return { ids, fetched: false };
  }
  try {
    const r = await fetchWithTimeout(
      `${BASE}/api/accounts?key=${encodeURIComponent(ADMIN_ACCOUNTS_KEY)}`,
      { headers: { "x-admin-key": ADMIN_ACCOUNTS_KEY } },
      8000
    );
    if (!r.ok) {
      log(` [accounts] 목록 조회 HTTP ${r.status} — 생성 계정을 차단 목록에 못 넣음.`);
      return { ids, fetched: false };
    }
    const list = await r.json().catch(() => []);
    if (!Array.isArray(list)) return { ids, fetched: false };
    for (const a of list) {
      const id = String(a?.id || "").trim().toLowerCase();
      if (id) ids.add(id);
    }
    log(` [accounts] 생성 계정 ${ids.size}개 차단 목록에 포함: [${[...ids].join(", ")}]`);
    return { ids, fetched: true };
  } catch (e) {
    log(` [accounts] 목록 조회 실패: ${String(e?.message || e).slice(0, 100)}`);
    return { ids, fetched: false };
  }
}

async function guardLiveBucket() {
  const cookieUserId = parseCookieUserId(COOKIE);
  const writeTarget = String(cookieUserId || TEST_USER || "").trim().toLowerCase();
  const { ids: createdIds } = await loadCreatedAccountIds();
  const blocked = new Set([...BUILTIN_LIVE_USERS, ...createdIds]);

  if (cookieUserId && cookieUserId !== String(TEST_USER).trim().toLowerCase()) {
    log(
      ` [warn] COOKIE id=${cookieUserId} 가 USER_ID=${TEST_USER} 와 다름. apply 는 쿠키 계정에 기록된다.`
    );
  }

  if (!blocked.has(writeTarget)) {
    log(` [guard] 허용 writeTarget=${writeTarget} (차단 목록 아님)`);
    return;
  }

  const reason = createdIds.has(writeTarget)
    ? "create-accounts 생성 계정"
    : "내장 라이브 계정(din/finalent/admin)";

  if (process.env.CONFIRM_LIVE === "1") {
    log(` [warn] CONFIRM_LIVE=1 — 차단 목록 우회. writeTarget=${writeTarget} (${reason})`);
    return;
  }

  log(`[FATAL] writeTarget=${writeTarget} 는 차단 목록이다. 테스트 후원이 실데이터에 섞인다.`);
  log(`        이유: ${reason}`);
  log("        차단 목록이 아닌 USER_ID 를 쓰거나, 라이브에 쏘려면 CONFIRM_LIVE=1 을 명시하라.");
  process.exit(3);
}

function buildPayloads(memberId) {
  const runId = `${Date.now()}-${rnd8hex()}`;
  const items = [];
  for (let i = 1; i <= TOTAL_EVENTS; i++) {
    const isBank = i % 2 === 0;
    const externalId = `dbt-${runId}-${String(i).padStart(4, "0")}`;
    const amount = ((i * 37) % 50) * 1000 + 1000;
    items.push({
      i,
      isBank,
      externalId,
      id: isBank ? `bank:stress:${externalId}` : `toonation:stress:${externalId}`,
      provider: isBank ? "bank" : "toonation",
      target: isBank ? "account" : "toon",
      donorName: `연사테스터_${i}`,
      amount,
      message: `[DB 기록 테스트] 1ms 폭포수 후원 #${i}`,
      at: Date.now() + i,
      memberId,
      donorKey: `dbt-${runId}-${i}`,
    });
  }
  return { runId, items };
}

async function waitHealth() {
  for (let i = 0; i < 10; i++) {
    try {
      const s = Date.now();
      const r = await fetchWithTimeout(`${BASE}/api/health`, {}, 4000);
      const ms = Date.now() - s;
      const j = await r.json().catch(() => ({}));
      log(
        ` [health] HTTP ${r.status} ${ms}ms ok=${j.ok} kv=${j.kvConfigured} redis=${j.redisConfigured} mysql=${j.mysqlOk ?? "NA"}`
      );
      if (r.ok || process.env.SKIP_HEALTH_CHECK === "1") return j;
    } catch (e) {
      log(` [health wait ${i + 1}/10] ${e?.name || ""} ${String(e?.message || e).slice(0, 80)}`);
    }
    await sleep(1500);
  }
  log("[FATAL] /api/health 실패. BASE 와 서버 기동을 확인하라.");
  process.exit(10);
}

async function fetchState() {
  const r = await fetchWithTimeout(
    `${BASE}/api/state?u=${encodeURIComponent(TEST_USER)}&t=${Date.now()}`,
    { headers: authHeaders(), cache: "no-store" },
    15_000
  );
  if (!r.ok) throw new Error("fetchState HTTP " + r.status);
  return await r.json();
}

async function resolveMemberId() {
  try {
    const st = await fetchState();
    const members = (st.members || []).filter((m) => m && String(m.id || "").trim());
    if (members[0]) {
      log(` [members] ${members.length}명 · apply memberId=${members[0].id} (${members[0].name || ""})`);
      return { memberId: String(members[0].id), donorBaseline: Number(st.donors?.length || 0) };
    }
    log(" [members] 0명 — placeholder memberId 사용 (apply 는 멤버 없으면 거절될 수 있음)");
    return { memberId: "m_stress_db_record", donorBaseline: Number(st.donors?.length || 0) };
  } catch (e) {
    log(` [members] state GET 실패: ${String(e?.message || e).slice(0, 100)}`);
    return { memberId: "m_stress_db_record", donorBaseline: 0 };
  }
}

function applyBody(p) {
  return {
    items: [
      {
        id: p.id,
        donorName: p.donorName,
        amount: p.amount,
        memberId: p.memberId,
        target: p.target,
        message: p.message,
        at: p.at,
        donorKey: p.donorKey,
        provider: p.provider,
        externalId: p.externalId,
      },
    ],
  };
}

function ingestBody(p) {
  return {
    id: p.id,
    provider: p.provider,
    externalId: p.externalId,
    donorName: p.donorName,
    amount: p.amount,
    at: new Date(p.at).toISOString(),
    status: "queued",
    target: p.target,
    message: p.message,
    memberId: p.memberId,
    manualAssignMemberId: p.memberId,
  };
}

async function fireOneHttp(p) {
  const started = Date.now();
  try {
    let url;
    let headers = authHeaders();
    let body;
    if (HTTP_PATH === "ingest") {
      if (!INGEST_SECRET) {
        return { ok: false, status: 0, ms: 0, err: "TOONA_INGEST_SECRET missing" };
      }
      url = `${BASE}/api/donations/ingest?u=${encodeURIComponent(TEST_USER)}&applyExcel=true&t=${Date.now()}`;
      headers = { ...headers, authorization: `Bearer ${INGEST_SECRET}` };
      body = ingestBody(p);
    } else {
      url = `${BASE}/api/donations/apply?u=${encodeURIComponent(TEST_USER)}&src=db_recording_test&t=${Date.now()}`;
      body = applyBody(p);
    }
    const resp = await fetchWithTimeout(
      url,
      { method: "POST", headers, body: JSON.stringify(body) },
      REQ_TIMEOUT_MS
    );
    const ms = Date.now() - started;
    let applied = 0;
    let err = null;
    try {
      const j = await resp.json();
      if (Array.isArray(j.applied)) applied = j.applied.length;
      else if (typeof j.applied === "number") applied = j.applied;
      else if (j.ok && j.applied === true) applied = 1;
      else if (j.ok && j.donorsCount != null) applied = 1;
      if (!resp.ok) err = j.error || j.message || `HTTP ${resp.status}`;
    } catch {
      /* ignore */
    }
    return { ok: resp.ok, status: resp.status, ms, applied, err };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      ms: Date.now() - started,
      applied: 0,
      err: e?.name === "AbortError" ? "timeout" : String(e?.message || e).slice(0, 120),
    };
  }
}

async function runHttpBurstTest() {
  log("=".repeat(72));
  log(` HTTP DB Record Test · ${TOTAL_EVENTS}건 · ${BURST_INTERVAL_MS}ms 간격`);
  log("=".repeat(72));
  log(` BASE=${BASE}`);
  log(` PATH=/${HTTP_PATH}  USER=${TEST_USER}  cookie=${COOKIE ? "yes" : "no"}`);
  log(` Log=${LOG_PATH}`);
  log(` 목표 발사 창 ≈ ${(TOTAL_EVENTS * BURST_INTERVAL_MS) / 1000}s`);
  log(" 동일 user 는 apply 가 per-user mutex 로 직렬화된다. 503 apply_timeout 은 락 대기 만료다.");

  await waitHealth();
  const { memberId, donorBaseline } = await resolveMemberId();
  const { items } = buildPayloads(memberId);
  const bankN = items.filter((p) => p.isBank).length;
  const toonN = items.length - bankN;
  log(` 페이로드: 계좌 ${bankN} · 투네 ${toonN} · baseline donors=${donorBaseline}`);

  const fireStarted = Date.now();
  const promises = items.map(
    (p, idx) =>
      new Promise((resolve) => {
        setTimeout(async () => {
          resolve(await fireOneHttp(p));
        }, idx * BURST_INTERVAL_MS);
      })
  );
  const results = await Promise.all(promises);
  const wallSec = (Date.now() - fireStarted) / 1000;

  const success = results.filter((r) => r.ok).length;
  const fail = results.length - success;
  const lats = results.map((r) => Number(r.ms) || 0).sort((a, b) => a - b);
  const avg = lats.length ? Math.round(lats.reduce((s, v) => s + v, 0) / lats.length) : 0;
  const statusCounts = {};
  for (const r of results) {
    const k = String(r.status || r.err || "NET");
    statusCounts[k] = (statusCounts[k] || 0) + 1;
  }
  const fails = results.filter((r) => !r.ok).slice(0, 8);
  if (fails.length) {
    log(
      ` 실패 샘플: ${fails.map((r) => `${r.status || "NET"}:${r.err || ""}`).join(" | ")}`
    );
  }

  let stateHit = null;
  let stateHitPct = null;
  if (VERIFY_STATE) {
    log(` [SETTLE] state 반영 대기 ${SETTLE_MS}ms ...`);
    await sleep(SETTLE_MS);
    try {
      const st = await fetchState();
      const donors = Array.isArray(st.donors) ? st.donors : [];
      const inject = new Set(items.map((p) => p.id));
      stateHit = donors.filter((d) => inject.has(String(d.id || ""))).length;
      stateHitPct = ((100 * stateHit) / items.length).toFixed(1);
      log(
        ` [state] donors ${donorBaseline} → ${donors.length} · 주입 ID 히트 ${stateHit}/${items.length}`
      );
    } catch (e) {
      log(` [state] 검증 실패: ${String(e?.message || e).slice(0, 100)}`);
    }
  }

  printReport("HTTP DB API", success, fail, wallSec, {
    avg,
    p50: percentile(lats, 0.5),
    p95: percentile(lats, 0.95),
    p99: percentile(lats, 0.99),
    max: lats[lats.length - 1] || 0,
    statusCounts,
    stateHit,
    expected: items.length,
    stateHitPct,
  });

  const dropOk = fail === 0;
  process.exit(dropOk ? 0 : 99);
}

async function runWebSocketBurstTest() {
  log("=".repeat(72));
  log(` WebSocket 송신 테스트 · ${WS_SERVER_URL}`);
  log("=".repeat(72));
  log(" 주의: 이 앱의 Overlay WS(:8080) 는 후원 DB 기록 경로가 아니다.");
  log("       기록 누락 검증은 TARGET_TYPE=HTTP 를 사용하라.");

  let WebSocket;
  try {
    ({ default: WebSocket } = await import("ws"));
  } catch {
    log("[FATAL] ws 패키지 없음. npm install ws");
    process.exit(11);
  }

  const { items } = buildPayloads("m_stress_db_record");
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_SERVER_URL);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error("ws connect timeout"));
    }, 8000);

    ws.on("error", (err) => {
      clearTimeout(timer);
      log("❌ 웹소켓 연결 오류:", err.message);
      reject(err);
    });

    ws.on("open", async () => {
      clearTimeout(timer);
      log("✅ 웹소켓 연결 성공. 1ms 연사 송신...");
      let sent = 0;
      const startTime = Date.now();
      for (let i = 0; i < items.length; i++) {
        const p = items[i];
        ws.send(
          JSON.stringify({
            event: "donation_record",
            data: {
              tx_id: p.externalId,
              provider: p.isBank ? "BANK" : "TOONATION",
              amount: p.amount,
              donor: p.donorName,
              memo: p.message,
            },
          })
        );
        sent++;
        if (BURST_INTERVAL_MS > 0) {
          const due = startTime + (i + 1) * BURST_INTERVAL_MS;
          const wait = due - Date.now();
          if (wait > 0) await sleep(wait);
        }
      }
      const totalTime = (Date.now() - startTime) / 1000;
      log("");
      log("==================================================");
      log("📊 [WebSocket 전송 리포트]");
      log(`- 전송한 패킷 수: ${sent} / ${TOTAL_EVENTS} 건`);
      log(`- 전송 완료 소요 시간: ${totalTime.toFixed(2)} 초`);
      log("==================================================");
      setTimeout(() => {
        ws.close();
        resolve();
      }, 1500);
    });
  });
  process.exit(0);
}

(async () => {
  await guardLiveBucket();
  if (TARGET_TYPE === "WEBSOCKET") {
    await runWebSocketBurstTest();
  } else {
    await runHttpBurstTest();
  }
})().catch((e) => {
  log("[FATAL]", e?.stack || String(e));
  process.exit(50);
});
