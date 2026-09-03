#!/usr/bin/env node
/**
 * PDF(새벽 2시까지) 기준으로 din donors 정렬 — bank:sms/toonation 중복 제거
 *
 * EC2:
 *   cd ~/youtube && git pull
 *   # PDF JSON 준비 (로컬에서 생성 후 scp, 또는 EC2에 PDF 두고 parse)
 *   node scripts/align-donors-to-pdf.mjs --pdf-json=tmp-pdf-until-2am.json --user=din --dry-run
 *   node scripts/align-donors-to-pdf.mjs --pdf-json=tmp-pdf-until-2am.json --user=din --apply
 *
 * 로컬(상태 JSON만 검사):
 *   node scripts/align-donors-to-pdf.mjs --pdf-json=tmp-pdf-until-2am.json --state=tmp-state-din.json --dry-run
 */
import fs from "fs";
import path from "path";
import mysql from "mysql2/promise";

const STATE_KEY_BASE = "excel-broadcast-state-v1";
const CUTOFF_ISO = "2026-09-02T02:00:00+09:00";
const CUTOFF = Date.parse(CUTOFF_ISO);
const MATCH_WINDOW_MS = 10 * 60 * 1000;
function matchWindowMs() {
  const g = globalThis.__ALIGN_MATCH_WINDOW_MS;
  return Number.isFinite(g) && g > 0 ? g : MATCH_WINDOW_MS;
}

function argVal(args, name, fallback = "") {
  const hit = args.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : fallback;
}

function loadEnvDatabaseUrl() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) throw new Error(".env 없음 — DATABASE_URL 확인");
  const raw = fs.readFileSync(envPath, "utf8");
  const line = raw.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
  if (!line) throw new Error("DATABASE_URL 없음");
  return line.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
}

function poolOptionsFromUrl(raw) {
  const u = new URL(raw);
  const database = decodeURIComponent(u.pathname.replace(/^\//, "").split("/")[0] || "");
  const hostname = (u.hostname || "127.0.0.1").toLowerCase();
  const shared = {
    user: decodeURIComponent(u.username || ""),
    password: decodeURIComponent(u.password || ""),
    database,
    connectTimeout: 15_000,
  };
  const useSocket =
    process.env.MYSQL_USE_SOCKET === "1" ||
    (process.env.MYSQL_USE_SOCKET !== "0" &&
      (hostname === "127.0.0.1" ||
        hostname === "localhost" ||
        /^172\.(1[6-9]|2[0-9]|3[01])\./.test(hostname)));
  if (useSocket) {
    return {
      ...shared,
      socketPath: process.env.MYSQL_SOCKET_PATH?.trim() || "/var/run/mysqld/mysqld.sock",
    };
  }
  return {
    ...shared,
    host: u.hostname || "127.0.0.1",
    port: u.port ? Number(u.port) : 3306,
  };
}

function normalizeNick(raw) {
  return String(raw || "")
    .replace(/\s+/g, "")
    .replace(/[.,:;!?~'"`()[\]{}<>_-]+/g, "")
    .toLowerCase();
}

function donorAtMs(d) {
  const n = Number(d?.at);
  if (Number.isFinite(n) && n > 1e11) return n;
  if (Number.isFinite(n) && n > 1e9 && n < 1e11) return n * 1000;
  const p = Date.parse(String(d?.at || ""));
  return Number.isFinite(p) ? p : 0;
}

function scoreMatch(pdfRow, donor) {
  if (Number(donor.amount) !== Number(pdfRow.amount)) return -1;
  const dn = normalizeNick(donor.name);
  const pn = pdfRow.nickKey || normalizeNick(pdfRow.nick);
  if (!dn || !pn) return -1;
  if (dn !== pn && !dn.includes(pn) && !pn.includes(dn)) return -1;
  const dt = Math.abs(donorAtMs(donor) - pdfRow.at);
  const window = matchWindowMs();
  let score = 1000;
  if (dt <= window) {
    score -= Math.floor(dt / 1000);
  } else {
    /** 시간창 밖이어도 메모가 강하게 같으면 허용 (임시 정산용) */
    const dm = String(donor.message || "")
      .replace(/\s+/g, "")
      .slice(0, 40);
    const pm = String(pdfRow.snip || "")
      .replace(/\s+/g, "")
      .slice(0, 40);
    const msgHit =
      dm &&
      pm &&
      (pm.includes(dm) ||
        dm.includes(pm) ||
        (dm.length >= 6 && pm.includes(dm.slice(0, Math.min(12, dm.length)))));
    if (!msgHit || dt > window * 6) return -1;
    score -= 400 + Math.floor(dt / 60000);
  }
  const id = String(donor.id || "");
  if (id.startsWith("toonation:")) score += 500;
  else if (id.startsWith("bank:")) score += 100;
  const target = donor.target || "account";
  if (target === pdfRow.target) score += 50;
  return score;
}

function pickDefaultMemberId(state) {
  const members = Array.isArray(state.members) ? state.members : [];
  const jaki = members.find((m) => String(m.name || "").includes("자키"));
  return jaki?.id || members[0]?.id || "";
}

function pickMemberIdForRow(state, row, fallbackId) {
  const members = Array.isArray(state.members) ? state.members : [];
  const hay = `${row.nick || ""} ${row.snip || ""}`;
  for (const m of members) {
    const name = String(m.name || "").trim();
    if (name && hay.includes(name)) return m.id;
  }
  return fallbackId;
}

function syncMemberTotalsFromDonors(state) {
  const totals = new Map();
  for (const member of state.members || []) {
    totals.set(member.id, { account: 0, toon: 0, contribution: 0 });
  }
  for (const donor of state.donors || []) {
    if (donor?.excludedFromTotals) continue;
    const memberId = String(donor.memberId || "").trim();
    if (!memberId || !totals.has(memberId)) continue;
    const bucket = totals.get(memberId);
    const amount = Math.max(0, Math.round(Number(donor.amount) || 0));
    if ((donor.target || "account") === "toon") bucket.toon += amount;
    else bucket.account += amount;
    const pts = Number(donor.contributionPoints);
    bucket.contribution += Number.isFinite(pts) && pts >= 0 ? pts : Math.floor(amount / 10);
  }
  const members = (state.members || []).map((member) => {
    const bucket = totals.get(member.id) || { account: 0, toon: 0, contribution: 0 };
    return {
      ...member,
      account: bucket.account,
      toon: bucket.toon,
      contribution: bucket.contribution,
    };
  });
  return { ...state, members };
}

function buildReplaceDonorsFromList(state, pdfRows) {
  const donorsBefore = Array.isArray(state.donors) ? state.donors : [];
  const defaultMemberId = pickDefaultMemberId(state);
  const created = pdfRows.map((row) => ({
    id: `xlsx:${row.src || "row"}:${row.at}:${row.amount}:${row.nickKey || "x"}`,
    name: row.nick || "무명",
    amount: Number(row.amount),
    at: row.at,
    target: row.target || "toon",
    memberId: pickMemberIdForRow(state, row, defaultMemberId),
    contributionPoints: Math.floor(Number(row.amount) / 10),
    message: row.snip || "",
  }));
  return {
    donors: created,
    stats: {
      pdfRows: pdfRows.length,
      keptMatched: 0,
      createdFromPdf: created.length,
      droppedTotal: donorsBefore.length,
      droppedAfterCutoff: 0,
      droppedDupOrExtra: donorsBefore.length,
      beforeSum: donorsBefore.reduce((a, d) => a + (Number(d.amount) || 0), 0),
      afterSum: created.reduce((a, d) => a + (Number(d.amount) || 0), 0),
      pdfSum: pdfRows.reduce((a, r) => a + (Number(r.amount) || 0), 0),
    },
    report: { unmatchedPdf: [], droppedSample: [], droppedAfterSample: [] },
  };
}

function buildAlignedDonors(state, pdfRows, opts = {}) {
  if (opts.replaceList === true) {
    return buildReplaceDonorsFromList(state, pdfRows);
  }
  const keepOnly = opts.keepOnly === true;
  const donors = Array.isArray(state.donors) ? [...state.donors] : [];
  const used = new Set();
  const kept = [];
  const created = [];
  const unmatchedPdf = [];
  const defaultMemberId = pickDefaultMemberId(state);

  for (const row of pdfRows) {
    let best = null;
    let bestScore = -1;
    for (let i = 0; i < donors.length; i++) {
      if (used.has(i)) continue;
      const sc = scoreMatch(row, donors[i]);
      if (sc > bestScore) {
        bestScore = sc;
        best = i;
      }
    }
    if (best != null && bestScore >= 0) {
      used.add(best);
      const d = { ...donors[best] };
      d.target = row.target || d.target || "toon";
      d.amount = Number(row.amount);
      d.name = String(d.name || row.nick || "").trim() || row.nick;
      if (!String(d.memberId || "").trim()) {
        d.memberId = pickMemberIdForRow(state, row, defaultMemberId);
      }
      kept.push(d);
    } else if (keepOnly) {
      /** 목록에만 있고 state에 없으면 생성하지 않음 — 항목 외 삭제만 */
      unmatchedPdf.push(row);
    } else {
      const id = `pdf:${row.src || "row"}:${row.at}:${row.amount}:${row.nickKey || "x"}`;
      const neo = {
        id,
        name: row.nick || "무명",
        amount: Number(row.amount),
        at: row.at,
        target: row.target || "toon",
        memberId: pickMemberIdForRow(state, row, defaultMemberId),
        contributionPoints: Math.floor(Number(row.amount) / 10),
        message: row.snip || "",
      };
      created.push(neo);
      unmatchedPdf.push(row);
      kept.push(neo);
    }
  }

  const dropped = donors.filter((_, i) => !used.has(i));
  const droppedAfterCutoff = dropped.filter((d) => donorAtMs(d) > CUTOFF);
  const droppedDupOrExtra = dropped.filter((d) => donorAtMs(d) <= CUTOFF);

  return {
    donors: kept,
    stats: {
      pdfRows: pdfRows.length,
      keptMatched: kept.length - created.length,
      createdFromPdf: created.length,
      droppedTotal: dropped.length,
      droppedAfterCutoff: droppedAfterCutoff.length,
      droppedDupOrExtra: droppedDupOrExtra.length,
      beforeSum: donors.reduce((a, d) => a + (Number(d.amount) || 0), 0),
      afterSum: kept.reduce((a, d) => a + (Number(d.amount) || 0), 0),
      pdfSum: pdfRows.reduce((a, r) => a + (Number(r.amount) || 0), 0),
    },
    report: {
      unmatchedPdf: unmatchedPdf.slice(0, 50),
      droppedSample: droppedDupOrExtra.slice(0, 40).map((d) => ({
        id: d.id,
        name: d.name,
        amount: d.amount,
        target: d.target,
        at: donorAtMs(d),
      })),
      droppedAfterSample: droppedAfterCutoff.slice(0, 20).map((d) => ({
        id: d.id,
        name: d.name,
        amount: d.amount,
        at: donorAtMs(d),
      })),
    },
  };
}

async function loadStateFromMysql(userId) {
  const url = loadEnvDatabaseUrl();
  const pool = mysql.createPool(poolOptionsFromUrl(url));
  const key = `${STATE_KEY_BASE}:${userId}`;
  try {
    const [rows] = await pool.query("SELECT v FROM app_kv WHERE k = ? LIMIT 1", [key]);
    const raw = rows?.[0]?.v;
    if (!raw) throw new Error(`state 키 없음: ${key}`);
    return { state: JSON.parse(raw), key, pool };
  } catch (e) {
    await pool.end();
    throw e;
  }
}

async function saveStateToMysql(pool, key, state) {
  const json = JSON.stringify(state);
  const rev = Number(state.updatedAt) || Date.now();
  await pool.query(
    `INSERT INTO app_kv (k, v, updated_at) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE v = VALUES(v), updated_at = VALUES(updated_at)`,
    [key, json, rev]
  );
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run") || !args.includes("--apply");
  const apply = args.includes("--apply");
  const keepOnly = args.includes("--keep-only");
  const replaceList = args.includes("--replace-list");
  const settlementReset = args.includes("--settlement-reset");
  const userId = argVal(args, "--user", "din");
  const pdfJsonPath = argVal(args, "--pdf-json", "tmp-pdf-until-2am.json");
  const statePath = argVal(args, "--state", "");
  const reportPath = argVal(args, "--report", "tmp-align-donors-report.json");
  const matchWindowArg = argVal(args, "--match-window-min", "");
  if (matchWindowArg) {
    const mins = Number(matchWindowArg);
    if (Number.isFinite(mins) && mins > 0) {
      // scoreMatch closes over MATCH_WINDOW_MS — override via global for this run
      globalThis.__ALIGN_MATCH_WINDOW_MS = mins * 60 * 1000;
    }
  }

  if (!fs.existsSync(pdfJsonPath)) {
    throw new Error(`PDF JSON 없음: ${pdfJsonPath}`);
  }
  const pdfPayload = JSON.parse(fs.readFileSync(pdfJsonPath, "utf8"));
  const pdfRows = Array.isArray(pdfPayload.rows) ? pdfPayload.rows : [];
  if (!pdfRows.length) throw new Error("PDF rows 비어 있음");

  let state;
  let pool = null;
  let key = null;
  if (statePath) {
    state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  } else {
    const loaded = await loadStateFromMysql(userId);
    state = loaded.state;
    pool = loaded.pool;
    key = loaded.key;
  }

  const beforeDonors = Array.isArray(state.donors) ? state.donors.length : 0;
  const aligned = buildAlignedDonors(state, pdfRows, { keepOnly, replaceList });
  const now = Date.now();
  let next = {
    ...state,
    donors: aligned.donors,
    updatedAt: now,
  };
  if (settlementReset) {
    next.settlementResetAt = now;
  }
  const resetAt = Number(next.settlementResetAt || 0);
  if (resetAt > 0) {
    /** 관리자 정산 리셋 stamp가 생일 목록 시각보다 뒤면, at을 올려야 후원이 필터로 안 지워짐 */
    next.donors = (next.donors || []).map((d, i) => {
      const at = Number(d.at) || 0;
      if (at >= resetAt - 3000) return d;
      return { ...d, at: resetAt + i };
    });
  }
  next = syncMemberTotalsFromDonors(next);

  const memberSummary = (next.members || []).map((m) => ({
    name: m.name,
    account: m.account,
    toon: m.toon,
    contribution: m.contribution,
    accountMan: Number(((m.account || 0) / 10000).toFixed(2)),
    toonMan: Number(((m.toon || 0) / 10000).toFixed(2)),
  }));

  const summary = {
    dryRun: dryRun && !apply,
    keepOnly,
    replaceList,
    settlementReset,
    matchWindowMin: matchWindowMs() / 60000,
    userId,
    cutoff: CUTOFF_ISO,
    beforeDonors,
    ...aligned.stats,
    beforeMan: Number((aligned.stats.beforeSum / 10000).toFixed(2)),
    afterMan: Number((aligned.stats.afterSum / 10000).toFixed(2)),
    pdfMan: Number((aligned.stats.pdfSum / 10000).toFixed(2)),
    memberSummary,
  };

  fs.writeFileSync(
    reportPath,
    JSON.stringify({ summary, report: aligned.report, donors: aligned.donors }, null, 2),
    "utf8"
  );
  console.log(JSON.stringify(summary, null, 2));
  console.log(`report: ${reportPath}`);

  if (apply) {
    if (!pool || !key) {
      throw new Error("--apply 는 MySQL(.env DATABASE_URL)에서만 가능. --state 모드는 dry-run 전용");
    }
    await saveStateToMysql(pool, key, next);
    console.log(`APPLIED key=${key} donors=${next.donors.length} updatedAt=${next.updatedAt}`);
    /** Node 메모리·SSE — 관리자가 「서버에서 가져오기」 없이 자동 반영 */
    const port = process.env.PORT || "3000";
    const reloadUrl = `http://127.0.0.1:${port}/api/ops/reload-state-from-kv?user=${encodeURIComponent(userId)}`;
    try {
      const res = await fetch(reloadUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const body = await res.text();
      console.log(`reload-state-from-kv HTTP ${res.status} ${body.slice(0, 240)}`);
    } catch (e) {
      console.warn(
        `reload-state-from-kv 실패 — pm2 restart 후 관리자 새로고침: ${e && e.message ? e.message : e}`
      );
      console.log("다음: pm2 restart youtube --update-env");
    }
  } else {
    console.log("dry-run — 적용하려면 --apply 추가");
  }

  if (pool) await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
