#!/usr/bin/env node
// 후원 장부를 주기적으로 읽기만 한다. 저장·정산 리셋·후원 반영은 하지 않는다.
//
//   node deploy/donation-watch.mjs --u paeza
//   node deploy/donation-watch.mjs --u din --base http://127.0.0.1:3000 --interval 5
//   node deploy/donation-watch.mjs --u paeza --once
//
// 종료 코드(--once): 0 정상, 1 중복·누락·되살아남 의심·허브를 못 읽음, 2 장부를 못 읽음.

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith("--")) return args[i + 1];
  return process.env[name.toUpperCase()] ?? fallback;
}
const TARGET_USER = arg("u", "din");
const BASE_URL = String(arg("base", "http://3.37.127.90")).replace(/\/+$/, "");
const INTERVAL_SEC = Math.max(1, Number(arg("interval", "3")) || 3);
const ONCE = args.includes("--once") || process.env.MODE === "once";
const COOKIE = `sb_user=${encodeURIComponent(JSON.stringify({ id: TARGET_USER }))}`;

const ID_PREFIXES = [
  "toonation:din:", "bank:din:", "bank:sms:", "toonation:", "bank:",
  "ingest:", "toona:", "account:", "din:", "hub:", "sms:",
];
/** 정산 리셋 rebump 는 at = 리셋 시각 + 순번(ms) — 이 구간의 새 행은 되살린 구 후원으로 의심한다 */
const REBUMP_WINDOW_MS = 1_000;

const krw = (n) => `${Math.round(Number(n) || 0).toLocaleString("ko-KR")}원`;
const kst = (t) =>
  Number(t) > 0 ? new Date(Number(t)).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "-";
function bareId(raw) {
  let cur = String(raw || "").trim();
  for (let i = 0; i < 8; i++) {
    const p = ID_PREFIXES.find((x) => cur.startsWith(x) && cur.length > x.length);
    if (!p) break;
    cur = cur.slice(p.length);
  }
  return cur;
}

async function getJson(path, withCookie) {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: withCookie ? { Cookie: COOKIE } : {},
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, data: await res.json() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

let prev = null;

async function runOnce() {
  const u = encodeURIComponent(TARGET_USER);
  const [stateRes, hubRes] = await Promise.all([
    getJson(`/api/state?u=${u}`, false),
    getJson(`/api/toona/hub?u=${u}`, true),
  ]);
  const lines = [`대상 ${TARGET_USER}  ${BASE_URL}  ${kst(Date.now())}`];

  const state = stateRes.ok ? stateRes.data?.state ?? stateRes.data : null;
  if (!state || !Array.isArray(state.donors)) {
    lines.push("판정: STATE_FAIL", "장부를 읽지 못했습니다. 0건으로 보지 않습니다.");
    return { code: 2, lines };
  }

  const donors = state.donors.filter((d) => d && String(d.id || "").trim());
  const groups = new Map();
  let sum = 0;
  for (const d of donors) {
    sum += Number(d.amount) || 0;
    const key = bareId(d.id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(d);
  }
  let extra = 0;
  const dups = [];
  for (const [key, rows] of groups) {
    if (rows.length > 1) {
      extra += rows.slice(1).reduce((s, r) => s + (Number(r.amount) || 0), 0);
      dups.push([key, rows]);
    }
  }

  const hub = hubRes.ok ? hubRes.data || {} : {};
  const hubOk = hub.ok === true;
  const logs = Array.isArray(hub.logs) && hub.logs.length ? hub.logs : hub.donationLogs || [];
  const missing = logs.filter((r) => r && r.id && !groups.has(bareId(r.id)));

  const resetAt = Number(state.settlementResetAt || 0);
  const preReset = donors.filter((d) => Number(d.at) > 0 && Number(d.at) < resetAt);
  const burstEnd = resetAt + donors.length + REBUMP_WINDOW_MS;
  const prevIds = prev?.ids ?? null;
  const burst = resetAt
    ? donors.filter(
        (d) =>
          Number(d.at) >= resetAt &&
          Number(d.at) < burstEnd &&
          (!prevIds || !prevIds.has(String(d.id)))
      )
    : [];
  const resetChanged = prev && prev.resetAt !== resetAt;

  let verdict = "OK";
  if (dups.length && missing.length) verdict = "DUP_MISSING";
  else if (dups.length) verdict = "DUP";
  else if (missing.length) verdict = "MISSING";
  if (burst.length >= 3) verdict = verdict === "OK" ? "REVIVE_SUSPECT" : `${verdict}+REVIVE_SUSPECT`;
  if (!hubOk && verdict === "OK") verdict = "HUB_FAIL";

  lines.push(`판정: ${verdict}`);
  if (resetChanged) {
    lines.push(`정산 리셋 감지: ${kst(prev.resetAt)} → ${kst(resetAt)}`);
  }
  lines.push(
    `허브: ${hubOk ? "정상" : `읽기 실패(${hubRes.status || hubRes.error || "응답 없음"})`}` +
      `  시나리오 ${hub.scenario || "?"}  세션 ${hub.session ? "있음" : "없음"}  로그 ${logs.length}줄`
  );
  lines.push(`장부 ${donors.length}줄  uid ${groups.size}개  합 ${krw(sum)}  중복으로 더 들어간 금액 ${krw(extra)}`);
  lines.push(`정산 리셋 ${kst(resetAt)}  마지막 저장 ${kst(state.updatedAt)}`);
  if (preReset.length) {
    lines.push(`리셋 이전 시각 후원 ${preReset.length}건 — 서버가 걸러야 할 행이 남아 있습니다.`);
  }
  if (burst.length) {
    lines.push(
      `리셋 직후 ${REBUMP_WINDOW_MS / 1000}초 안에 몰린 새 후원 ${burst.length}건 ${krw(
        burst.reduce((s, d) => s + (Number(d.amount) || 0), 0)
      )} — 옛 후원이 되살아났을 수 있습니다.`
    );
  }
  if (prev) {
    const added = [...groups.keys()].filter((k) => !prev.uids.has(k));
    const removed = [...prev.uids].filter((k) => !groups.has(k)).length;
    lines.push(`직전보다 uid ${added.length}개 추가  ${removed}개 사라짐  합 변화 ${krw(sum - prev.sum)}`);
    for (const k of added.slice(0, 3)) {
      const d = groups.get(k)[0];
      lines.push(`  + ${kst(d.at)}  ${d.name || d.donorName || ""}  ${krw(d.amount)}  ${d.target || ""}`);
    }
  }
  const members = (state.members || [])
    .map(
      (m) =>
        `${m.name} 계좌 ${krw(m.account)} 투네 ${krw(m.toon)} 기여 ${krw(m.contribution)}${
          m.operating ? " [운영비]" : ""
        }`
    )
    .join(" | ");
  if (members) lines.push(`멤버: ${members}`);
  if (missing.length) {
    lines.push(`허브에만 있고 장부에 없는 후원 ${missing.length}건:`);
    for (const r of missing.slice(0, 3)) {
      lines.push(`  ${bareId(r.id)} ${krw(r.amount)} ${r.donorName || r.name || ""}`);
    }
  }
  if (dups.length) {
    lines.push("두 줄로 들어간 예:");
    for (const [key, rows] of dups.slice(0, 3)) {
      lines.push(`  ${key} ${krw(rows[0].amount)} × ${rows.length}`);
    }
  }
  if (!logs.length && hubOk) {
    lines.push("허브 로그가 없어 빠짐(MISSING)은 판정하지 못했습니다.");
  }

  prev = {
    resetAt,
    sum,
    uids: new Set(groups.keys()),
    ids: new Set(donors.map((d) => String(d.id))),
  };
  return { code: verdict === "OK" ? 0 : 1, lines };
}

if (ONCE) {
  const { code, lines } = await runOnce();
  console.log(lines.join("\n"));
  process.exit(code);
}

for (;;) {
  const { lines } = await runOnce();
  if (process.stdout.isTTY) process.stdout.write("\x1b[H\x1b[2J");
  console.log(lines.join("\n"));
  await new Promise((r) => setTimeout(r, INTERVAL_SEC * 1000));
}
