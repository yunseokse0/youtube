#!/usr/bin/env node
/**
 * DIN 라이브 후원 정합성 진단
 * 실제 isWeakToonationDonorId / normalizeDonationEventId / L505-506 과 같은 판정.
 *
 *   cd /home/ubuntu/youtube && node scripts/diagnose-donor-integrity.mjs
 *   node scripts/diagnose-donor-integrity.mjs --user=din
 *
 * state 로드: MySQL app_kv 우선 (HTTP 세션·HOME 재귀 스캔 없음).
 * HTTP /api/state 는 보조로만 시도하고, 실패 이유를 출력한다.
 */
import fs from "fs";
import path from "path";
import mysql from "mysql2/promise";

const STATE_KEY = "excel-broadcast-state-v1";
const NEAR_MS = 3_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX32_RE = /^[0-9a-f]{32}$/i;

function argVal(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1).trim() : fallback;
}

function loadEnvFile() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (k && process.env[k] == null) process.env[k] = v;
  }
}

function loadEnvDatabaseUrl() {
  loadEnvFile();
  const url = String(process.env.DATABASE_URL || "").trim();
  if (!url) throw new Error("DATABASE_URL 없음 (.env)");
  return url.replace(/^["']|["']$/g, "");
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
    process.env.MYSQL_USE_SOCKET !== "0" &&
    (hostname === "127.0.0.1" ||
      hostname === "localhost" ||
      /^172\.(1[6-9]|2[0-9]|3[01])\./.test(hostname));
  if (useSocket) {
    return {
      ...shared,
      socketPath: process.env.MYSQL_SOCKET_PATH?.trim() || "/var/run/mysqld/mysqld.sock",
    };
  }
  return { ...shared, host: u.hostname || "127.0.0.1", port: u.port ? Number(u.port) : 3306 };
}

/** src/domain/dedupe/donation-dedupe.rules.ts normalizeDonationEventId */
function normalizeDonationEventId(id) {
  let base = String(id || "").trim();
  if (!base) return "";
  base = base.replace(/^(ingest|toona|account|din|hub|poll|push|dinpush|din_ingest|din_hub):/i, "");
  base = base.replace(/::[a-z]+$/i, "");
  base = base.replace(/^(toonation|bank|other|toon|투네|toona):/i, "");
  base = base.replace(/^(din|hub|self):/i, "");
  return base;
}

function isReliableToonationExternalId(id) {
  const s = String(id || "").trim();
  if (!s || s === "0") return false;
  if (/^test$/i.test(s)) return false;
  if (/^(fp-|test-|toon-)/i.test(s)) return false;
  if (/^\d{10,13}-\d+(-\d+-[a-z0-9]+)?$/i.test(s)) return false;
  return true;
}

/** src/lib/donation/toonation/parse-event.ts extractReliableToonationExtFromDonorId */
function extractReliableToonationExtFromDonorId(id) {
  const raw = String(id || "").trim();
  if (!raw) return null;
  const toonationPrefixed = /^(toonation|toona):/i.test(raw);
  const isRawPureUuid32 = HEX32_RE.test(raw);
  const isRawStandardUuid = UUID_RE.test(raw);
  const isToonDonorIdPattern = /^toon-/i.test(raw);
  if (!toonationPrefixed && !isRawPureUuid32 && !isRawStandardUuid && !isToonDonorIdPattern) {
    return null;
  }
  let ext = raw.replace(/^(toonation|toona):/i, "").replace(/::review$/i, "");
  if (!ext) return null;
  while (/^[a-z][a-z0-9_-]*:/i.test(ext)) {
    ext = ext.replace(/^[a-z][a-z0-9_-]*:/i, "");
  }
  if (!ext) return null;
  const normalizeAsUuid32 = (s) => {
    const hyphenStripped = String(s || "").toLowerCase().replace(/-/g, "");
    return /^[0-9a-f]{32}$/.test(hyphenStripped) ? hyphenStripped : null;
  };
  const extUuid32 = normalizeAsUuid32(ext);
  if (extUuid32 && (toonationPrefixed || isRawPureUuid32 || isRawStandardUuid)) return extUuid32;
  if (toonationPrefixed && isReliableToonationExternalId(ext)) {
    return extUuid32 ? extUuid32 : ext.toLowerCase();
  }
  const toonMatch = /^toon-(.+?)-(\d{10,})/i.exec(ext);
  if (
    toonMatch?.[1] &&
    isReliableToonationExternalId(toonMatch[1]) &&
    (toonationPrefixed || isToonDonorIdPattern)
  ) {
    const realUuid = normalizeAsUuid32(toonMatch[1]);
    return realUuid ? realUuid : toonMatch[1].toLowerCase();
  }
  return null;
}

/** src/domain/dedupe/donation-dedupe.rules.ts isWeakToonationDonorId */
function isWeakToonationDonorId(id) {
  const raw = String(id || "").trim();
  if (!raw) return false;
  if (/^(bank|sms|account|din_bank|gyejwa):/i.test(raw)) return false;
  const reliableExt = extractReliableToonationExtFromDonorId(raw);
  if (reliableExt) return false;
  const base = normalizeDonationEventId(raw).replace(/^toonation:/i, "").replace(/^(toona|tuna):/i, "");
  if (!base) return false;
  if (/^din:/i.test(base)) return false;
  if (/^(fp-|test-|toon-|seq-|don-|stub-|mock-)/i.test(base)) return true;
  if (/^\d{10,13}-\d+(-\d+-[a-z0-9]+)?$/i.test(base)) return true;
  if (UUID_RE.test(base)) return false;
  if (HEX32_RE.test(base)) return false;
  return true;
}

function donorAtEpochMs(raw) {
  if (raw == null) return 0;
  let n;
  if (typeof raw === "number") n = raw < 1e10 ? raw * 1000 : raw;
  else if (typeof raw === "string") {
    const t = raw.trim();
    if (/^-?\d+$/.test(t)) {
      const x = Number(t);
      n = x < 1e10 ? x * 1000 : x;
    } else n = Date.parse(raw) || 0;
  } else n = Date.parse(String(raw)) || 0;
  return Math.max(0, Math.round(Number.isFinite(n) ? n : 0));
}

function contentKey(d) {
  const name = String(d?.donorName ?? d?.name ?? "")
    .trim()
    .toLowerCase();
  const amount = Math.max(0, Math.round(Number(d?.amount) || 0));
  const target = String(d?.target || "account").trim().toLowerCase() === "toon" ? "toon" : "account";
  const msg = String(d?.message || "").trim().toLowerCase();
  return `${name}|${amount}|${target}|${msg}`;
}

function fmt(n) {
  return Number(n || 0).toLocaleString("ko-KR");
}

function isValidRow(d) {
  if (!d || d.deletedAt) return false;
  if (d.donationExcluded === true) return false;
  if (String(d.id || "").includes(":split:") || d.groupSplit === true) return false;
  return true;
}

async function loadFromMysql(userId) {
  const key = `${STATE_KEY}:${userId}`;
  const pool = mysql.createPool(poolOptionsFromUrl(loadEnvDatabaseUrl()));
  try {
    const [rows] = await pool.query("SELECT v FROM app_kv WHERE k = ? LIMIT 1", [key]);
    const v = rows?.[0]?.v;
    if (!v) return { ok: false, error: `app_kv 없음 (${key})`, donors: null };
    const state = typeof v === "string" ? JSON.parse(v) : v;
    if (!state || !Array.isArray(state.donors)) {
      return { ok: false, error: `JSON donors 배열 없음 (${key})`, donors: null };
    }
    return { ok: true, error: "", donors: state.donors, state };
  } catch (e) {
    return { ok: false, error: String(e?.message || e), donors: null };
  } finally {
    await pool.end().catch(() => {});
  }
}

async function loadFromHttp(userId) {
  const port = String(process.env.PORT || "3000").replace(/\D/g, "") || "3000";
  const urls = [
    `http://127.0.0.1:${port}/api/state?u=${encodeURIComponent(userId)}`,
    `http://127.0.0.1:3000/api/state?u=${encodeURIComponent(userId)}`,
    `http://127.0.0.1:3001/api/state?u=${encodeURIComponent(userId)}`,
  ];
  const tried = [];
  for (const url of [...new Set(urls)]) {
    try {
      const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
      const text = await res.text();
      if (!res.ok) {
        tried.push(`${url} → HTTP ${res.status} ${text.slice(0, 80)}`);
        continue;
      }
      const j = JSON.parse(text);
      const donors = Array.isArray(j?.donors) ? j.donors : Array.isArray(j?.state?.donors) ? j.state.donors : null;
      if (!donors) {
        tried.push(`${url} → JSON에 donors 없음`);
        continue;
      }
      return { ok: true, error: "", donors, src: url };
    } catch (e) {
      tried.push(`${url} → ${e?.message || e}`);
    }
  }
  return { ok: false, error: tried.join(" | "), donors: null };
}

async function main() {
  const userId = argVal("--user", process.env.DIN_DEFAULT_USER || "din");
  console.log("=".repeat(78));
  console.log(`DIN 후원 정합성 진단  | user=${userId}`);
  console.log("=".repeat(78));

  const mysqlLoad = await loadFromMysql(userId);
  const httpLoad = await loadFromHttp(userId);

  console.log(`MySQL app_kv : ${mysqlLoad.ok ? `OK ${mysqlLoad.donors.length}건` : `실패 ${mysqlLoad.error}`}`);
  console.log(`HTTP /api/state : ${httpLoad.ok ? `OK ${httpLoad.donors.length}건 (${httpLoad.src})` : `실패 ${httpLoad.error}`}`);

  let donors = null;
  let src = "";
  if (mysqlLoad.ok && httpLoad.ok) {
    donors = httpLoad.donors.length >= mysqlLoad.donors.length ? httpLoad.donors : mysqlLoad.donors;
    src = httpLoad.donors.length >= mysqlLoad.donors.length ? httpLoad.src : `MySQL ${STATE_KEY}:${userId}`;
  } else if (httpLoad.ok) {
    donors = httpLoad.donors;
    src = httpLoad.src;
  } else if (mysqlLoad.ok) {
    donors = mysqlLoad.donors;
    src = `MySQL ${STATE_KEY}:${userId}`;
  } else {
    console.log("\nstate 로드 실패. PM2: pm2 status youtube / .env DATABASE_URL 확인");
    process.exit(1);
  }

  const all = donors;
  const valid = all.filter(isValidRow);
  console.log(`스캔 소스: ${src}`);
  console.log("-".repeat(78));
  console.table([
    {
      구분: "유효 후원",
      건수: valid.length,
      총액: `${fmt(valid.reduce((s, d) => s + Number(d.amount || 0), 0))}원`,
    },
    {
      구분: "소프트삭제",
      건수: all.filter((d) => d?.deletedAt).length,
      총액: `${fmt(all.filter((d) => d?.deletedAt).reduce((s, d) => s + Number(d.amount || 0), 0))}원`,
    },
    {
      구분: "후원제외",
      건수: all.filter((d) => d?.donationExcluded === true && !d?.deletedAt).length,
      총액: `${fmt(all.filter((d) => d?.donationExcluded === true && !d?.deletedAt).reduce((s, d) => s + Number(d.amount || 0), 0))}원`,
    },
    {
      구분: "분할",
      건수: all.filter((d) => String(d?.id || "").includes(":split:") || d?.groupSplit === true).length,
      총액: `${fmt(all.filter((d) => String(d?.id || "").includes(":split:") || d?.groupSplit === true).reduce((s, d) => s + Number(d.amount || 0), 0))}원`,
    },
  ]);

  const byNorm = new Map();
  valid.forEach((d, i) => {
    const k = normalizeDonationEventId(d.id);
    if (!k) return;
    if (!byNorm.has(k)) byNorm.set(k, []);
    byNorm.get(k).push({
      i,
      d,
      id: String(d.id || "").trim(),
      weak: isWeakToonationDonorId(d.id),
      amt: Number(d.amount || 0),
    });
  });
  const dupNorm = [...byNorm.entries()].filter(([, rows]) => rows.length >= 2);

  const byC = new Map();
  valid.forEach((d, i) => {
    const k = contentKey(d);
    if (!byC.has(k)) byC.set(k, []);
    byC.get(k).push({
      i,
      d,
      at: donorAtEpochMs(d.at),
      id: String(d.id || "").trim(),
      weak: isWeakToonationDonorId(d.id),
      amt: Number(d.amount || 0),
    });
  });
  let dupC = 0;
  let dupCAmt = 0;
  const dupCSample = [];
  for (const [, rows] of byC) {
    if (rows.length < 2) continue;
    rows.sort((a, b) => a.at - b.at);
    for (let a = 0; a < rows.length; a += 1) {
      for (let b = a + 1; b < rows.length; b += 1) {
        if (Math.abs(rows[a].at - rows[b].at) > NEAR_MS) continue;
        const aNorm = normalizeDonationEventId(rows[a].id);
        const bNorm = normalizeDonationEventId(rows[b].id);
        if (aNorm && bNorm && aNorm === bNorm) continue;
        const aStrong = Boolean(rows[a].id) && !rows[a].weak;
        const bStrong = Boolean(rows[b].id) && !rows[b].weak;
        if (aStrong || bStrong) continue;
        dupC += 1;
        dupCAmt += rows[a].amt + rows[b].amt;
        if (dupCSample.length < 10) dupCSample.push({ a: rows[a], b: rows[b] });
      }
    }
  }

  console.log("-".repeat(78));
  console.table([
    {
      검사: "1) Norm ID 완전일치",
      그룹: dupNorm.length,
      중복건: dupNorm.reduce((s, [, v]) => s + v.length, 0),
      중복액: `${fmt(dupNorm.reduce((s, [, v]) => s + v.reduce((a, r) => a + r.amt, 0), 0))}원`,
      판정: dupNorm.length === 0 ? "정상" : "수정필요",
    },
    {
      검사: "2) 양쪽 Weak + 3초 내용일치 (L506 Strong bypass)",
      그룹: dupC,
      중복건: dupC * 2,
      중복액: `${fmt(dupCAmt)}원`,
      판정: dupC === 0 ? "정상" : "Weak ID만 의심",
    },
  ]);

  if (dupNorm.length) {
    console.log("\n[수정필요] Norm ID 일치 중복 (상위 12):");
    dupNorm.slice(0, 12).forEach(([k, rows], gi) => {
      console.log(`  #${gi + 1} norm=${k.slice(0, 48)} | ${rows.length}건 ${fmt(rows.reduce((s, r) => s + r.amt, 0))}원`);
      rows.forEach((r) => {
        console.log(
          `    idx[${String(r.i).padStart(5)}] ${r.weak ? "Weak  " : "Strong"} | ${r.id.slice(0, 42).padEnd(42)} | ${new Date(donorAtEpochMs(r.d.at)).toLocaleString("ko-KR")} | ${fmt(r.amt)}원`
        );
      });
    });
  }

  if (dupC) {
    console.log("\n[Weak ID만 의심] 양쪽 Weak + 3초 내용일치 (상위 10):");
    dupCSample.forEach(({ a, b }, gi) => {
      console.log(`  #${gi + 1} ${contentKey(a.d).slice(0, 56)} | 간격 ${Math.abs(a.at - b.at)}ms`);
      [a, b].forEach((r) => {
        console.log(
          `    idx[${String(r.i).padStart(5)}] Weak | ${r.id.slice(0, 40).padEnd(40)} | ${new Date(r.at).toLocaleString("ko-KR")} | ${fmt(r.amt)}원`
        );
      });
    });
  }

  if (dupNorm.length === 0 && dupC === 0) {
    console.log("\n진단 결과: 중복 레코드 0건");
  }
  console.log("=".repeat(78));
}

main().catch((e) => {
  console.error("오류:", e?.message || e);
  if (e?.stack) console.error(e.stack);
  process.exit(2);
});
