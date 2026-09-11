import crypto from "node:crypto";

const TARGET = process.env.TARGET || "https://din.finalent.com";
const USER_ID = process.env.USER_ID || "din";
const POLL_MS = Number(process.env.POLL_MS || "3000");
const DEDUP_WINDOW_MS = Number(process.env.WINDOW_MS || "5000");
const REPORT_SUMMARY_EVERY = Number(process.env.SUMMARY_EVERY || "40");
const SOUND_ALERT = process.env.ALERT !== "0";
const SKIP_SETTLEMENT_EXCLUDED = process.env.SKIP_EXCLUDED !== "0";
const ENABLE_LOOSE_WARN = process.env.LOOSE_WARN === "1"; // 기본 OFF — 필요시 LOOSE_WARN=1 로 명시적 활성화

const SSE_URL = `${TARGET}/api/events`;
const STATE_URL = `${TARGET}/api/state?u=${encodeURIComponent(USER_ID)}&t=`;

function now() {
  const d = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}
function fmt(n) {
  return Number(n || 0).toLocaleString();
}
function rnd8hex() {
  const b = Buffer.alloc(4);
  crypto.getRandomValues(b);
  return b.toString("hex");
}

const fetchWithTimeout = async (url, opts = {}, timeoutMs = 15_000) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
};

function normalizeName(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[^a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ]/g, "")
    .toLowerCase();
}

function buildStrongSig(d) {
  const ext = String(d.externalId || "").trim().toLowerCase();
  const dk = String(d.donorKey || "").trim().toLowerCase();
  const pk = String(d.primaryKey || "").trim().toLowerCase();
  const idRaw = String(d.id || "").trim();
  let idBase = idRaw
    .replace(/^(ingest|toona|account|din|hub|poll|push|din_ingest|din_hub):/i, "")
    .replace(/::[a-z]+$/i, "")
    .replace(/^(toonation|bank|other|toon|투네|toona):/i, "")
    .replace(/^(din|hub|self):/i, "")
    .toLowerCase();
  return { ext, dk, pk, idBase };
}

/**
 * donor 리스트에서 중복 의심쌍을 모두 탐지한다.
 * 레벨 1: STRONG 키 (externalId / donorKey / primaryKey / idBase) 완전일치 — 99.9% 확실한 진짜 중복
 * 레벨 2: 이름+금액+target+memberId+at±5초 + 메시지RAW 완전일치 — fallback exact 중복
 * 레벨 3: 이름+금액+at±10초 (메시지 빠졌을때 경고용) — 약한 경고
 */
function scanDuplicates(donors) {
  const list = (donors || []).map((d, i) => {
    const amt = Math.max(0, Math.round(Number(d.amount) || 0));
    const atRaw = d.at;
    let atMs = 0;
    if (typeof atRaw === "number" && Number.isFinite(atRaw) && atRaw > 0) {
      atMs = atRaw < 10_000_000_000 ? Math.round(atRaw * 1000) : Math.round(atRaw);
    } else if (typeof atRaw === "string") {
      const n = Number(atRaw.trim());
      if (Number.isFinite(n) && n > 0) atMs = n < 10_000_000_000 ? Math.round(n * 1000) : Math.round(n);
      else {
        const p = Date.parse(atRaw);
        if (Number.isFinite(p) && p > 0) atMs = p;
      }
    }
    return {
      idx: i,
      raw: d,
      id: String(d.id || "").trim(),
      amt,
      atMs,
      nameNorm: normalizeName(d.donorName || d.name),
      donorName: String(d.donorName || d.name || "(無)").trim(),
      msgRaw: String(d.message || "").trim(),
      target: String(d.target || "toon").trim().toLowerCase(),
      memberId: String(d.memberId || "").trim().toLowerCase(),
      excluded: !!d.donationExcluded,
      strong: buildStrongSig(d),
    };
  });
  if (SKIP_SETTLEMENT_EXCLUDED) {
    for (const d of list) {
      if (d.excluded) d._skip = true;
    }
  }

  const dupGroups = [];

  // level 1 strong sigs — 각 strong key별로 bucket
  const bucket = (keyLabel) => {
    const map = new Map();
    for (const d of list) {
      if (d._skip || d.amt <= 0) continue;
      const k = d.strong[keyLabel];
      if (!k) continue;
      const bk = `${keyLabel}:${k}:${d.amt}`;
      if (!map.has(bk)) map.set(bk, []);
      map.get(bk).push(d);
    }
    for (const [, arr] of map) {
      if (arr.length >= 2) {
        dupGroups.push({
          level: 1,
          levelLabel: `STRONG-${keyLabel.toUpperCase()} EXACT`,
          severity: "CRITICAL",
          items: [...arr],
          sample: arr[0],
          note: "동일 externalId/donorKey/primaryKey/id로 2건 이상 적재됨 = 진짜 중복 99.9%",
        });
      }
    }
  };
  bucket("ext");
  bucket("dk");
  bucket("pk");
  bucket("idBase");

  // level 2 — 6요소 exact (이름+금액+메시지비지않음+target+memberId+at ± 5초)
  const bucketExact = new Map();
  for (const d of list) {
    if (d._skip || d.amt <= 0) continue;
    if (!d.msgRaw) continue;
    const atBucket = Math.max(0, Math.floor(d.atMs / 5_000));
    const key = `${d.nameNorm}:${d.amt}:${d.target}:${d.memberId}:${atBucket}`;
    if (!bucketExact.has(key)) bucketExact.set(key, []);
    bucketExact.get(key).push(d);
  }
  for (const [, arr] of bucketExact) {
    if (arr.length < 2) continue;
    const groups = [];
    const used = new Array(arr.length).fill(false);
    for (let i = 0; i < arr.length; i++) {
      if (used[i]) continue;
      const g = [arr[i]];
      used[i] = true;
      for (let j = i + 1; j < arr.length; j++) {
        if (used[j]) continue;
        const a = arr[i], b = arr[j];
        const nameOk = a.nameNorm && a.nameNorm === b.nameNorm;
        const amtOk = a.amt > 0 && a.amt === b.amt;
        const msgOk = a.msgRaw && b.msgRaw && a.msgRaw === b.msgRaw;
        const tgtOk = !a.target || !b.target || a.target === b.target;
        const memOk = !a.memberId || !b.memberId || a.memberId === b.memberId;
        const atOk = a.atMs && b.atMs && Math.abs(a.atMs - b.atMs) <= DEDUP_WINDOW_MS;
        if (nameOk && amtOk && msgOk && tgtOk && memOk && atOk) {
          g.push(b);
          used[j] = true;
        }
      }
      if (g.length >= 2) groups.push(g);
    }
    for (const g of groups) {
      dupGroups.push({
        level: 2,
        levelLabel: "6-ELEMENT EXACT (fallback)",
        severity: "HIGH",
        items: g,
        sample: g[0],
        note: "이름+금액+메시지RAW+target+memberId+시간 모두 일치 = Strong ID 없어도 중복일 가능성 높음",
      });
    }
  }

  // level 3 — 3요소 loose 경고용 (이름+금액+at ±10초 · 메시지 빠졌거나 다를 수 있음)
  // 기본 OFF (ENABLE_LOOSE_WARN=1 환경변수로 명시적으로 켤 때만 활성화 — 허위 양성 너무 많아서)
  if (ENABLE_LOOSE_WARN) {
  const bucketLoose = new Map();
  for (const d of list) {
    if (d._skip || d.amt <= 0) continue;
    const atBucket = Math.max(0, Math.floor(d.atMs / 10_000));
    const key = `${d.nameNorm}:${d.amt}:${atBucket}`;
    if (!bucketLoose.has(key)) bucketLoose.set(key, []);
    bucketLoose.get(key).push(d);
  }
  for (const [, arr] of bucketLoose) {
    if (arr.length < 2) continue;
    const groups = [];
    const used = new Array(arr.length).fill(false);
    for (let i = 0; i < arr.length; i++) {
      if (used[i]) continue;
      const g = [arr[i]];
      used[i] = true;
      for (let j = i + 1; j < arr.length; j++) {
        if (used[j]) continue;
        const a = arr[i], b = arr[j];
        const nameOk = a.nameNorm && a.nameNorm === b.nameNorm;
        const amtOk = a.amt > 0 && a.amt === b.amt;
        const atOk = a.atMs && b.atMs && Math.abs(a.atMs - b.atMs) <= 10_000;
        if (nameOk && amtOk && atOk) {
          g.push(b);
          used[j] = true;
        }
      }
      if (g.length >= 2) groups.push(g);
    }
    for (const g of groups) {
      const isSubsetOfHigher = dupGroups.some(dg => {
        if (dg.level === 3) return false;
        const ids = new Set(dg.items.map(x => x.idx));
        return g.every(x => ids.has(x.idx));
      });
      if (isSubsetOfHigher) continue;
      dupGroups.push({
        level: 3,
        levelLabel: "3-ELEMENT LOOSE (경고)",
        severity: "WARN",
        items: g,
        sample: g[0],
        note: "이름+금액+시간만 일치 (메시지 다를 수 있음) · 수동 확인 필요",
      });
    }
  }
  } // END if (ENABLE_LOOSE_WARN)

  return { list, dupGroups };
}

function groupId(g) {
  const head = g.sample;
  return `${g.levelLabel}:${head.nameNorm.slice(0, 12)}:${head.amt}:${g.items.length}_${rnd8hex()}`;
}

function beep(times = 3) {
  if (!SOUND_ALERT) return;
  try {
    for (let i = 0; i < times; i++) process.stdout.write("\x07");
  } catch {}
}

function printBanner() {
  console.log("=".repeat(96));
  console.log(`🛡  LIVE 후원 중복 실시간 모니터링 (scanner v1.0) — ${now()}`);
  console.log(`   대상 서버 : ${TARGET}`);
  console.log(`   사용자 ID : ${USER_ID}`);
  console.log(`   폴링 간격 : ${POLL_MS}ms (${(POLL_MS/1000).toFixed(1)}초)`);
  console.log(`   dedupe 윈도우 : exact=${DEDUP_WINDOW_MS}ms`);
  console.log(`   L3 Loose WARN (이름+금액+±10초) : ${ENABLE_LOOSE_WARN ? "ON (허위 양성 다수 유의)" : "OFF (기본) · LOOSE_WARN=1 로 켜기)"}`);
  console.log(`   정산제외 후원 스킵 : ${SKIP_SETTLEMENT_EXCLUDED ? "YES (donationExcluded 제외)" : "NO"}`);
  console.log(`   소리 알림 : ${SOUND_ALERT ? "ON (터미널 벨)" : "OFF"}`);
  console.log(`   SSE 시그널 리슨 : ${SSE_URL}`);
  console.log(`   중복 레벨 : L1(CRITICAL)=Strong Key exact / L2(HIGH)=6요소 exact${ENABLE_LOOSE_WARN ? " / L3(WARN)=3요소 loose 경고" : ""}`);
  console.log("=".repeat(96));
}

function printDuplicate(g, isNew) {
  const tag = isNew ? "🔥 [NEW DUP DETECTED]" : "👀 [RE-CHECK]";
  const color = g.severity === "CRITICAL" ? "\x1b[31m" : g.severity === "HIGH" ? "\x1b[33m" : "\x1b[36m";
  const reset = "\x1b[0m";
  console.log("");
  console.log(`${color}${tag} [${g.severity}] ${g.levelLabel} — ${now()}${reset}`);
  console.log(`   ${g.note}`);
  console.log(`   대표 donor: ${g.sample.donorName} · 금액 ${fmt(g.sample.amt)}원 · 메시지「${g.sample.msgRaw || "(빈칸)"}」`);
  console.log(`   중복 건수: ${g.items.length}건 (${g.items.length - 1}건 초과 적재 → 총액 ${fmt((g.items.length - 1) * g.sample.amt)}원 부풀림)`);
  console.log(`   개별 행 상세:`);
  for (let k = 0; k < g.items.length; k++) {
    const x = g.items[k];
    const strongParts = [];
    if (x.strong.ext) strongParts.push(`ext=${x.strong.ext}`);
    if (x.strong.dk) strongParts.push(`dk=${x.strong.dk}`);
    if (x.strong.pk) strongParts.push(`pk=${x.strong.pk}`);
    if (x.strong.idBase) strongParts.push(`idBase=${x.strong.idBase}`);
    const atStr = x.atMs > 0 ? new Date(x.atMs).toISOString().replace("T", " ").slice(0, 19) : "(at=無)";
    console.log(`    ${k+1}. [${x.id || "id=?"}]  at=${atStr}  amount=${fmt(x.amt)}  target=${x.target}  memberId=${x.memberId || "‐"}  ${strongParts.join(" · ") || "(Strong Key 없음)"}`);
    if (x.excluded) console.log(`       ⚠️  donationExcluded=true로 정산 집계 제외됨 (중복 영향 없음)`);
  }
  if (g.severity === "CRITICAL") beep(3);
  else if (g.severity === "HIGH") beep(2);
  console.log("");
}

(async function main() {
  printBanner();

  // SSE 리슨 (업데이트 시그널 받으면 즉시 추가 폴링 · 없으면 폴링만으로 동작)
  let latestSseAt = 0;
  (async () => {
    let backoff = 2_000;
    let failCount = 0;
    while (true) {
      try {
        const r = await fetchWithTimeout(SSE_URL, {
          method: "GET",
          headers: { "Accept": "text/event-stream", "User-Agent": "dup-monitor/1.0-sse" },
          cache: "no-store",
        }, 0);
        if (!r.ok || !r.body) {
          failCount++;
          console.log(`[SSE] 연결 실패 HTTP ${r.status} · ${failCount}회째 — ${backoff/1000}초 후 재시도 (폴링만으로 정상 동작하니 괜찮음 · 실패가 계속되면 아래 진단 명령어 실행)`);
          if (failCount >= 3 && failCount % 3 === 0) {
            console.log(`     💡 진단 ① 서버 살아있는가?:  Invoke-RestMethod -Uri ${TARGET}/api/health -Method GET | ConvertTo-Json`);
            console.log(`     💡 진단 ② state 접근 되는가?:   Invoke-RestMethod -Uri '${STATE_URL.slice(0, STATE_URL.length - 2)}' -Method GET | ConvertTo-Json -Depth 5`);
            console.log(`     💡 진단 ③ Basic/IP 화이트리스트?:  크롬 시크릿 모드로 ${TARGET} 열어서 로그인 페이지가 뜨거나 403이 뜨는지 확인`);
          }
          await new Promise(p => setTimeout(p, backoff));
          backoff = Math.min(backoff * 2, 30_000);
          continue;
        }
        console.log(`[SSE] 연결됨 — state 업데이트 시 실시간 반영 flag ⚡ ON`);
        backoff = 2_000;
        failCount = 0;
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        let idleBytesAt = Date.now();
        const watchdog = setInterval(() => {
          if (Date.now() - idleBytesAt > 35_000) {
            console.log(`[SSE] 35초간 데이터 없어서 연결 재시작 (NGINX 60초 read timeout 전 안전 재접)`);
            try { reader.cancel("idle_timeout"); } catch {}
          }
        }, 5_000);
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            idleBytesAt = Date.now();
            buf += dec.decode(chunk.value, { stream: true });
            let cut;
            while ((cut = buf.indexOf("\n\n")) >= 0) {
              const frame = buf.slice(0, cut);
              buf = buf.slice(cut + 2);
              if (frame.includes("data:")) latestSseAt = Date.now();
            }
          }
        } catch (e) {
          const name = e?.name || "";
          if (name === "AbortError" || name === "TimeoutError" || String(e).includes("aborted")) {
            console.log(`[SSE] 정상 재시작 트리거 · 백오프 없이 즉시 재접속`);
            backoff = 500;
          } else {
            console.log(`[SSE] 끊김: ${name} ${String(e?.message || "").slice(0,80)}`);
          }
        } finally {
          clearInterval(watchdog);
        }
      } catch (e) {
        failCount++;
        console.log(`[SSE] NET 에러 · ${backoff/1000}초 후 재시도 · msg=${String(e?.message || e).slice(0,160)}`);
        console.log(`     ⚠️  폴링(POLL_MS ${POLL_MS}ms)만으로 중복탐지 100% 정상 동작하니 SSE 실패 자체는 지장 없음. fetch fail 이 함께 뜨면 아래를 먼저 의심:`);
        console.log(`        1) Basic Auth 필요한데 인증 안보냄? → TARGET=https://user:pass@din.finalent.com 로 바꿔보기`);
        console.log(`        2) 회사 IP가 화이트리스트 미등록? → EC2 Nginx allowlist 또는 CloudFront WAF 확인`);
        console.log(`        3) 로컬 DNS / TLS 문제 → 크롬으로 ${TARGET} 열어서 인증서 정상 뜨는지 확인`);
        await new Promise(p => setTimeout(p, backoff));
        backoff = Math.min(backoff * 2, 30_000);
      }
    }
  })();

  const reported = new Map(); // groupSig -> firstSeenAt
  let tick = 0;
  // 첫 snapshot 기준으로 알고있는 행들의 id 집합 — 신규 유입 추적용
  let prevIds = new Set();
  let firstRun = true;

  const loopOnce = async () => {
    tick++;
    try {
      const url = STATE_URL + Date.now() + "_" + rnd8hex();
      const r = await fetchWithTimeout(url, { cache: "no-store", headers: { "User-Agent": "dup-monitor/1.0" } }, 12_000);
      if (!r.ok) {
        console.log(`[${now()}] HTTP GET state 실패 ${r.status}`);
        return;
      }
      const st = await r.json();
      const donors = Array.isArray(st?.donors) ? st.donors : [];
      const totalDonors = donors.length;
      const { list, dupGroups } = scanDuplicates(donors);
      const gross = list.reduce((s, d) => s + (d._skip ? 0 : d.amt), 0);
      const overcount = dupGroups.reduce((s, g) => s + (g.items.length - 1), 0);
      const oversum = dupGroups.reduce((s, g) => s + (g.items.length - 1) * (g.items[0]?.amt || 0), 0);
      const curIds = new Set(list.map(x => String(x.id || `anon_${x.idx}_${x.atMs}_${x.nameNorm}_${x.amt}`)));
      const newInflow = [...curIds].filter(x => !prevIds.has(x)).length;
      prevIds = curIds;

      // 콘솔 한줄 상태 (매 2틱마다 출력)
      if (tick % 2 === 0 || dupGroups.length > 0) {
        const sseFlag = latestSseAt && (Date.now() - latestSseAt < 15_000) ? "⚡" : "·";
        console.log(`[${now()}] ${sseFlag} donors=${fmt(totalDonors)} gross=${fmt(gross)}원 · inflow신규=${newInflow} · 중복그룹=${dupGroups.length} · 중복초과건수=${overcount}건 · 부풀림총액=${fmt(oversum)}원`);
      }

      // 신규 중복 그룹 탐지
      for (const g of dupGroups) {
        const sig = `${g.level}|${g.sample.nameNorm}|${g.sample.amt}|${g.sample.msgRaw.length > 0 ? "msg1" : "msg0"}|${g.items.length}|${g.items.map(x => x.idx).join(",")}`;
        const already = reported.has(sig);
        if (!already) {
          reported.set(sig, { first: Date.now(), count: 1, groupId: groupId(g) });
          if (firstRun) {
            console.log(`\n[기준선 snapshot] L${g.level} 기존에 존재하는 중복 그룹 1건 적발 (${g.items.length}건 중복 · ${fmt((g.items.length - 1) * g.sample.amt)}원 부풀림)`);
            printDuplicate(g, false);
          } else {
            printDuplicate(g, true);
          }
        } else {
          const meta = reported.get(sig);
          meta.count += 1;
        }
      }

      // 주기적 요약 보고
      if (tick % REPORT_SUMMARY_EVERY === 0) {
        console.log("\n" + "─".repeat(96));
        console.log(`📊 [${now()}] 주기적 요약 — ${REPORT_SUMMARY_EVERY}틱 경과`);
        console.log(`   총 donors : ${fmt(totalDonors)}건 · 집계대상총액 : ${fmt(gross)}원`);
        console.log(`   지금까지 적발된 중복 그룹 수 : ${reported.size}건`);
        const byLv = new Map();
        for (const g of dupGroups) {
          byLv.set(g.levelLabel, (byLv.get(g.levelLabel) || 0) + 1);
        }
        for (const [k, v] of byLv) console.log(`     - ${k} : ${v}건`);
        console.log(`   누적 초과 적재 건수 : ${overcount}건 · 총액 ${fmt(oversum)}원`);
        if (reported.size === 0) console.log("   ✅ 현재까지 중복 그룹 0건 — 깨끗한 상태");
        console.log("─".repeat(96));
      }

      firstRun = false;
    } catch (e) {
      console.log(`[${now()}] 폴링 에러: ${e?.name} ${e?.message?.slice(0,160) || ""}`);
    }
  };

  await loopOnce();
  setInterval(async () => { await loopOnce(); }, POLL_MS);
})();
