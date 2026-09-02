#!/usr/bin/env node
/**
 * monolith settlement-records(~8MB array) → 일별 shard 마이그레이션
 *
 *   cd ~/youtube && node scripts/migrate-settlement-records-shards.mjs --user=din --dry-run
 *   node scripts/migrate-settlement-records-shards.mjs --user=din
 */
import fs from "fs";
import mysql from "mysql2/promise";

const RECORDS_KEY = "excel-broadcast-settlement-records-v1";
const INDEX_KEY = "excel-broadcast-settlement-records-index-v1";

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

function monolithKey(userId) {
  return `${RECORDS_KEY}:${userId}`;
}

function shardKey(userId, dateKey) {
  return `${RECORDS_KEY}:${userId}:${dateKey}`;
}

function indexKey(userId) {
  return `${INDEX_KEY}:${userId}`;
}

/** KST YYYY-MM-DD — broadcastDateKey 와 동일 규칙 */
function dateKeyFromMs(ms) {
  const d = new Date(Number(ms) || Date.now());
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const day = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function groupByDate(records) {
  const map = new Map();
  for (const r of records) {
    if (!r || typeof r !== "object") continue;
    const dk = dateKeyFromMs(r.createdAt);
    if (!map.has(dk)) map.set(dk, []);
    map.get(dk).push(r);
  }
  return map;
}

async function run() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const userArg = args.find((a) => a.startsWith("--user="));
  const userId = userArg ? userArg.split("=")[1] : "din";

  const pool = mysql.createPool(poolOptionsFromUrl(loadEnvDatabaseUrl()));
  const monoKey = monolithKey(userId);

  try {
    const [rows] = await pool.execute(
      "SELECT `v`, CHAR_LENGTH(`v`) AS len FROM app_kv WHERE `k` = ? LIMIT 1",
      [monoKey]
    );
    const row = rows[0];
    if (!row) {
      console.log(`[migrate-settlement] monolith 없음: ${monoKey}`);
      return;
    }
    const bytes = Number(row.len) || String(row.v ?? "").length;
    let parsed;
    try {
      parsed = JSON.parse(row.v);
    } catch {
      console.log(`[migrate-settlement] JSON 파싱 실패 (${bytes} bytes)`);
      return;
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.__migrated === true) {
      console.log(`[migrate-settlement] 이미 마이그레이션됨 (${monoKey})`);
      return;
    }
    if (!Array.isArray(parsed)) {
      console.log(`[migrate-settlement] monolith가 배열이 아님 — skip`);
      return;
    }

    const byDate = groupByDate(parsed);
    const dates = [...byDate.keys()].sort();
    console.log(
      `[migrate-settlement] user=${userId} records=${parsed.length} days=${dates.length} bytes≈${bytes} dryRun=${dryRun}`
    );
    for (const d of dates) {
      console.log(`  ${d}: ${byDate.get(d).length} records`);
    }
    if (dryRun) return;

    const now = Date.now();
    let written = 0;
    for (const dateKey of dates) {
      const list = byDate.get(dateKey) || [];
      if (!list.length) continue;
      const sk = shardKey(userId, dateKey);
      const payload = JSON.stringify(list);
      await pool.execute(
        `INSERT INTO app_kv (\`k\`, \`v\`, \`expires_at\`, \`updated_at\`)
         VALUES (?, ?, NULL, ?)
         ON DUPLICATE KEY UPDATE \`v\` = VALUES(\`v\`), \`updated_at\` = VALUES(\`updated_at\`)`,
        [sk, payload, now]
      );
      written += 1;
      console.log(`  shard OK ${sk} (${list.length} records, ${payload.length} bytes)`);
    }

    const dateKeysDesc = [...dates].sort((a, b) => b.localeCompare(a));
    const indexPayload = JSON.stringify({ dateKeys: dateKeysDesc, updatedAt: now });
    await pool.execute(
      `INSERT INTO app_kv (\`k\`, \`v\`, \`expires_at\`, \`updated_at\`)
       VALUES (?, ?, NULL, ?)
       ON DUPLICATE KEY UPDATE \`v\` = VALUES(\`v\`), \`updated_at\` = VALUES(\`updated_at\`)`,
      [indexKey(userId), indexPayload, now]
    );

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
      dateKeys: dateKeysDesc,
      bakKey,
    });
    await pool.execute(`UPDATE app_kv SET \`v\` = ?, \`updated_at\` = ? WHERE \`k\` = ?`, [
      stub,
      now,
      monoKey,
    ]);
    console.log(
      `[migrate-settlement] 완료 — ${written} shards, index=${indexKey(userId)}, backup=${bakKey}`
    );
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
