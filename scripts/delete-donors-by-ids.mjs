#!/usr/bin/env node
/**
 * 지정 donor id 만 제거 (정산용 임시 정리). settlementReset 미사용.
 *
 * EC2:
 *   cd ~/youtube
 *   node scripts/delete-donors-by-ids.mjs --user=din --ids=tmp-birthday-delete-ids.json --dry-run
 *   node scripts/delete-donors-by-ids.mjs --user=din --ids=tmp-birthday-delete-ids.json --apply
 *   pm2 restart youtube --update-env
 */
import fs from "fs";
import path from "path";
import mysql from "mysql2/promise";

const STATE_KEY_BASE = "excel-broadcast-state-v1";

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

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const dryRun = !apply;
  const userId = argVal(args, "--user", "din");
  const idsPath = argVal(args, "--ids", "tmp-birthday-delete-ids.json");
  if (!fs.existsSync(idsPath)) throw new Error(`ids 파일 없음: ${idsPath}`);
  const payload = JSON.parse(fs.readFileSync(idsPath, "utf8"));
  const deleteIds = new Set(
    Array.isArray(payload.deleteIds)
      ? payload.deleteIds.map(String)
      : Array.isArray(payload)
        ? payload.map(String)
        : []
  );
  if (!deleteIds.size) throw new Error("deleteIds 비어 있음");

  const url = loadEnvDatabaseUrl();
  const pool = mysql.createPool(poolOptionsFromUrl(url));
  const key = `${STATE_KEY_BASE}:${userId}`;
  try {
    const [rows] = await pool.query("SELECT v FROM app_kv WHERE k = ? LIMIT 1", [key]);
    const raw = rows?.[0]?.v;
    if (!raw) throw new Error(`state 키 없음: ${key}`);
    const state = JSON.parse(raw);
    const before = Array.isArray(state.donors) ? state.donors : [];
    const removed = before.filter((d) => deleteIds.has(String(d.id)));
    const kept = before.filter((d) => !deleteIds.has(String(d.id)));
    const missing = [...deleteIds].filter((id) => !before.some((d) => String(d.id) === id));
    let next = {
      ...state,
      donors: kept,
      updatedAt: Date.now(),
    };
    next = syncMemberTotalsFromDonors(next);
    const summary = {
      dryRun,
      userId,
      key,
      before: before.length,
      removed: removed.length,
      after: kept.length,
      missingOnServer: missing.length,
      beforeSum: before.reduce((a, d) => a + (Number(d.amount) || 0), 0),
      afterSum: kept.reduce((a, d) => a + (Number(d.amount) || 0), 0),
      removedSum: removed.reduce((a, d) => a + (Number(d.amount) || 0), 0),
      removedSample: removed.slice(0, 15).map((d) => ({
        id: d.id,
        name: d.name,
        amount: d.amount,
      })),
    };
    console.log(JSON.stringify(summary, null, 2));
    if (apply) {
      const json = JSON.stringify(next);
      const rev = Number(next.updatedAt) || Date.now();
      await pool.query(
        `INSERT INTO app_kv (k, v, updated_at) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE v = VALUES(v), updated_at = VALUES(updated_at)`,
        [key, json, rev]
      );
      console.log(`APPLIED donors=${kept.length} updatedAt=${next.updatedAt}`);
      console.log("다음: pm2 restart youtube --update-env");
    } else {
      console.log("dry-run — 적용하려면 --apply");
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
