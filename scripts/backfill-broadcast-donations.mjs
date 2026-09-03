#!/usr/bin/env node
/**
 * app_kv state donors → broadcast_donations 백필 (Phase 1)
 *
 *   cd ~/youtube && node scripts/backfill-broadcast-donations.mjs --user=din
 *   node scripts/backfill-broadcast-donations.mjs --user=din --dry-run
 */
import fs from "fs";
import mysql from "mysql2/promise";
import { ungzip } from "pako";

const STATE_KEY = "excel-broadcast-state-v1";
const UPSERT_CHUNK = 200;

function loadEnvDatabaseUrl() {
  const envPath = new URL("../.env", import.meta.url);
  if (!fs.existsSync(envPath)) {
    throw new Error(".env 없음 — DATABASE_URL 확인");
  }
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
    connectTimeout: 10_000,
  };
  const useSocket =
    process.env.MYSQL_USE_SOCKET === "1" ||
    (process.env.MYSQL_USE_SOCKET !== "0" &&
      (hostname === "127.0.0.1" ||
        hostname === "localhost" ||
        /^172\.(1[6-9]|2[0-9]|3[01])\./.test(hostname)));
  if (useSocket) {
    const socketPath =
      process.env.MYSQL_SOCKET_PATH?.trim() || "/var/run/mysqld/mysqld.sock";
    return { ...shared, socketPath };
  }
  return {
    ...shared,
    host: u.hostname || "127.0.0.1",
    port: u.port ? Number(u.port) : 3306,
  };
}

const DDL = `
CREATE TABLE IF NOT EXISTS broadcast_donations (
  user_id VARCHAR(64) NOT NULL,
  id VARCHAR(128) NOT NULL,
  name VARCHAR(191) NOT NULL,
  amount INT NOT NULL,
  member_id VARCHAR(128) NOT NULL,
  at_ms BIGINT NOT NULL,
  target VARCHAR(16) NULL,
  message TEXT NULL,
  member_auto_assigned TINYINT(1) NOT NULL DEFAULT 0,
  group_split TINYINT(1) NOT NULL DEFAULT 0,
  group_split_source TINYINT(1) NOT NULL DEFAULT 0,
  donation_excluded TINYINT(1) NOT NULL DEFAULT 0,
  hs_territory_excluded TINYINT(1) NOT NULL DEFAULT 0,
  hs_push_dir VARCHAR(16) NULL,
  contribution_points INT NULL,
  updated_at_ms BIGINT NOT NULL,
  PRIMARY KEY (user_id, id),
  KEY idx_user_at (user_id, at_ms),
  KEY idx_user_member (user_id, member_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

function bool01(v) {
  return v === true || v === 1 || v === "1" ? 1 : 0;
}

function normalizeTarget(v) {
  const s = String(v || "").trim();
  return s === "account" || s === "toon" ? s : null;
}

function normalizePushDir(v) {
  const s = String(v || "").trim();
  return s === "left" || s === "right" || s === "split" ? s : null;
}

function donorToRow(userId, d, updatedAtMs) {
  const points = Number(d.contributionPoints);
  return [
    String(userId).slice(0, 64),
    String(d.id || "").slice(0, 128),
    String(d.name || "").slice(0, 191) || "익명",
    Math.max(0, Math.floor(Number(d.amount) || 0)),
    String(d.memberId || "").slice(0, 128),
    Math.max(0, Math.floor(Number(d.at) || 0)),
    normalizeTarget(d.target),
    d.message != null ? String(d.message) : null,
    bool01(d.memberAutoAssigned),
    bool01(d.groupSplit),
    bool01(d.groupSplitSource),
    bool01(d.donationExcluded),
    bool01(d.hsTerritoryExcluded),
    normalizePushDir(d.hsPushDir),
    Number.isFinite(points) ? Math.round(points) : null,
    updatedAtMs,
  ];
}

function parseDonors(state) {
  if (!state || typeof state !== "object") return [];
  const raw = Array.isArray(state.donors) ? state.donors : [];
  const out = [];
  const seen = new Set();
  for (const d of raw) {
    const id = String(d?.id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(d);
  }
  return out;
}

function maybeUngzipState(parsed) {
  if (!parsed || typeof parsed !== "object" || typeof parsed.__gzipB64 !== "string") {
    return parsed;
  }
  const buf = Buffer.from(parsed.__gzipB64, "base64");
  const json = Buffer.from(ungzip(buf)).toString("utf8");
  return JSON.parse(json);
}

async function run() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const userArg = args.find((a) => a.startsWith("--user="));
  const userId = (userArg ? userArg.slice("--user=".length) : "din").trim() || "din";

  const url = loadEnvDatabaseUrl();
  const pool = mysql.createPool(poolOptionsFromUrl(url));
  const key = `${STATE_KEY}:${userId}`;
  const updatedAtMs = Date.now();

  try {
    await pool.execute(DDL);
    const [rows] = await pool.execute(`SELECT v FROM app_kv WHERE k = ? LIMIT 1`, [key]);
    const raw = rows[0]?.v;
    if (raw == null) {
      console.error(`state key missing: ${key}`);
      process.exitCode = 1;
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(typeof raw === "string" ? raw : String(raw));
    } catch {
      console.error("state JSON parse failed");
      process.exitCode = 1;
      return;
    }
    try {
      parsed = maybeUngzipState(parsed);
    } catch (err) {
      console.error("gzip decode failed", err);
      process.exitCode = 1;
      return;
    }

    const donors = parseDonors(parsed);
    console.log(`user=${userId} donors=${donors.length} dryRun=${dryRun}`);

    if (dryRun) {
      console.log("dry-run OK — no writes");
      return;
    }

    await pool.execute(`DELETE FROM broadcast_donations WHERE user_id = ?`, [userId]);

    const upsertSql = `
INSERT INTO broadcast_donations (
  user_id, id, name, amount, member_id, at_ms, target, message,
  member_auto_assigned, group_split, group_split_source, donation_excluded,
  hs_territory_excluded, hs_push_dir, contribution_points, updated_at_ms
) VALUES ?
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  amount = VALUES(amount),
  member_id = VALUES(member_id),
  at_ms = VALUES(at_ms),
  target = VALUES(target),
  message = VALUES(message),
  member_auto_assigned = VALUES(member_auto_assigned),
  group_split = VALUES(group_split),
  group_split_source = VALUES(group_split_source),
  donation_excluded = VALUES(donation_excluded),
  hs_territory_excluded = VALUES(hs_territory_excluded),
  hs_push_dir = VALUES(hs_push_dir),
  contribution_points = VALUES(contribution_points),
  updated_at_ms = VALUES(updated_at_ms)
`;

    for (let i = 0; i < donors.length; i += UPSERT_CHUNK) {
      const chunk = donors.slice(i, i + UPSERT_CHUNK);
      const values = chunk.map((d) => donorToRow(userId, d, updatedAtMs));
      await pool.query(upsertSql, [values]);
    }

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS n FROM broadcast_donations WHERE user_id = ?`,
      [userId]
    );
    const n = Number(countRows[0]?.n || 0);
    console.log(`backfill done table_count=${n} state_donors=${donors.length}`);
    if (n !== donors.length) {
      console.warn("WARN: count mismatch");
      process.exitCode = 2;
    }
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
