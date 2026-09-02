#!/usr/bin/env node
/**
 * monolith daily-log(23MB) → 일별 shard 마이그레이션
 *
 *   cd ~/youtube && node scripts/migrate-daily-log-shards.mjs --user=din
 *   node scripts/migrate-daily-log-shards.mjs --user=din --dry-run
 */
import fs from "fs";
import mysql from "mysql2/promise";

const DAILY_LOG_KEY = "excel-broadcast-daily-log-v1";

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

function monolithKey(userId) {
  return `${DAILY_LOG_KEY}:${userId}`;
}

function shardKey(userId, dateKey) {
  return `${DAILY_LOG_KEY}:${userId}:${dateKey}`;
}

function parseMonolith(raw) {
  if (!raw) return null;
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  if (obj.__migrated === true) return null;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !Array.isArray(v)) continue;
    out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

async function run(opts = {}) {
  const args = process.argv.slice(2);
  const dryRun = opts.dryRun ?? args.includes("--dry-run");
  const userArg = args.find((a) => a.startsWith("--user="));
  const userId = opts.userId ?? (userArg ? userArg.split("=")[1] : "din");

  const dbUrl = loadEnvDatabaseUrl();
  const pool = mysql.createPool(poolOptionsFromUrl(dbUrl));
  const monoKey = monolithKey(userId);

  try {
    const [rows] = await pool.execute(
      "SELECT `v`, CHAR_LENGTH(`v`) AS len FROM app_kv WHERE `k` = ? LIMIT 1",
      [monoKey]
    );
    const row = rows[0];
    if (!row) {
      console.log(`[migrate-daily-log] monolith 없음: ${monoKey}`);
      return { ok: true, days: 0, bytes: 0 };
    }
    const bytes = Number(row.len) || String(row.v ?? "").length;
    const monolith = parseMonolith(row.v);
    if (!monolith) {
      console.log(`[migrate-daily-log] 이미 마이그레이션됨 또는 파싱 불가 (${monoKey}, ${bytes} bytes)`);
      return { ok: true, days: 0, bytes };
    }
    const dates = Object.keys(monolith).sort();
    console.log(`[migrate-daily-log] user=${userId} days=${dates.length} bytes≈${bytes} dryRun=${dryRun}`);

    if (dryRun) {
      for (const d of dates) {
        const n = monolith[d]?.length ?? 0;
        console.log(`  ${d}: ${n} entries`);
      }
      return { ok: true, days: dates.length, bytes, dryRun: true };
    }

    const now = Date.now();
    let written = 0;
    for (const dateKey of dates) {
      const entries = monolith[dateKey];
      if (!Array.isArray(entries) || entries.length === 0) continue;
      const sk = shardKey(userId, dateKey);
      const payload = JSON.stringify(entries);
      await pool.execute(
        `INSERT INTO app_kv (\`k\`, \`v\`, \`expires_at\`, \`updated_at\`)
         VALUES (?, ?, NULL, ?)
         ON DUPLICATE KEY UPDATE \`v\` = VALUES(\`v\`), \`updated_at\` = VALUES(\`updated_at\`)`,
        [sk, payload, now]
      );
      written += 1;
      console.log(`  shard OK ${sk} (${entries.length} entries, ${payload.length} bytes)`);
    }

    const bakKey = `${monoKey}:BAK`;
    await pool.execute(
      `INSERT INTO app_kv (\`k\`, \`v\`, \`expires_at\`, \`updated_at\`)
       VALUES (?, ?, NULL, ?)
       ON DUPLICATE KEY UPDATE \`v\` = VALUES(\`v\`), \`updated_at\` = VALUES(\`updated_at\`)`,
      [bakKey, row.v, now]
    );
    const stub = JSON.stringify({
      __migrated: true,
      at: now,
      days: written,
      bakKey,
    });
    await pool.execute(
      `UPDATE app_kv SET \`v\` = ?, \`updated_at\` = ? WHERE \`k\` = ?`,
      [stub, now, monoKey]
    );
    console.log(`[migrate-daily-log] 완료 — ${written} shards, backup=${bakKey}, monolith→stub`);
    return { ok: true, days: written, bytes };
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.includes("migrate-daily-log-shards")) {
  run().catch((err) => {
    console.error("[migrate-daily-log] FAILED", err);
    process.exit(1);
  });
}

export { run };
