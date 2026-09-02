#!/usr/bin/env node
/**
 * donors 중복 정리 — toonation 우선, bank 재전송·교차 경로 제거
 *
 *   cd ~/youtube && node scripts/dedupe-donors-state.mjs --user=din --dry-run
 *   node scripts/dedupe-donors-state.mjs --user=din --apply
 */
import fs from "fs";
import path from "path";
import mysql from "mysql2/promise";

const STATE_KEY = "excel-broadcast-state-v1";
const CROSS_MS = 180_000;
const BANK_MS = 60_000;

function loadEnvDatabaseUrl() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) throw new Error(".env 없음");
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

function kind(id) {
  const s = String(id || "").toLowerCase();
  if (s.startsWith("bank:")) return "bank";
  if (s.startsWith("toonation:") || s.startsWith("toona:")) return "toonation";
  return "other";
}

function nameKey(n) {
  return String(n || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function atMs(d) {
  const n = Number(d?.at);
  if (Number.isFinite(n) && n > 1e11) return n;
  const p = Date.parse(String(d?.at || ""));
  return Number.isFinite(p) ? p : 0;
}

function preferScore(d) {
  const k = kind(d.id);
  if (k === "toonation") return 300;
  if (k === "other") return 200;
  return 100; // bank last
}

/**
 * 이름+금액이 같고 시간창 안이면 1건만 유지.
 * 우선순위: toonation > other > bank, 동점이면 더 이른 at.
 */
export function dedupeDonorList(donors) {
  const sorted = [...(donors || [])].sort((a, b) => atMs(a) - atMs(b));
  const kept = [];
  const dropped = [];

  for (const d of sorted) {
    const nk = nameKey(d.name);
    const amount = Math.max(0, Math.round(Number(d.amount) || 0));
    const t = atMs(d);
    const k = kind(d.id);
    const hit = kept.find((x) => {
      if (nameKey(x.name) !== nk || Math.max(0, Math.round(Number(x.amount) || 0)) !== amount) {
        return false;
      }
      const dt = Math.abs(atMs(x) - t);
      const xk = kind(x.id);
      if ((xk === "bank" && k === "toonation") || (xk === "toonation" && k === "bank")) {
        return dt <= CROSS_MS;
      }
      if (xk === "bank" && k === "bank") return dt <= BANK_MS;
      if (xk === "toonation" && k === "toonation") {
        // 서로 다른 toonation id 는 유지 (연속 후원)
        return String(x.id) === String(d.id);
      }
      return dt <= BANK_MS && String(x.id) !== String(d.id)
        ? nameKey(x.name) === nk && amount === Math.max(0, Math.round(Number(x.amount) || 0))
        : false;
    });

    if (!hit) {
      kept.push(d);
      continue;
    }

    // 더 나은 소스면 교체
    if (preferScore(d) > preferScore(hit)) {
      const idx = kept.indexOf(hit);
      dropped.push(hit);
      kept[idx] = d;
    } else {
      dropped.push(d);
    }
  }

  return {
    donors: kept.sort((a, b) => atMs(b) - atMs(a)),
    dropped,
  };
}

function syncMembers(state) {
  const totals = new Map();
  for (const m of state.members || []) totals.set(m.id, { account: 0, toon: 0, contribution: 0 });
  for (const d of state.donors || []) {
    const mid = String(d.memberId || "").trim();
    if (!mid || !totals.has(mid)) continue;
    const b = totals.get(mid);
    const amount = Math.max(0, Math.round(Number(d.amount) || 0));
    if ((d.target || "account") === "toon") b.toon += amount;
    else b.account += amount;
    const pts = Number(d.contributionPoints);
    b.contribution += Number.isFinite(pts) && pts >= 0 ? pts : Math.floor(amount / 10);
  }
  return {
    ...state,
    members: (state.members || []).map((m) => {
      const b = totals.get(m.id) || { account: 0, toon: 0, contribution: 0 };
      return { ...m, account: b.account, toon: b.toon, contribution: b.contribution };
    }),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const dryRun = !apply;
  const userId = (args.find((a) => a.startsWith("--user=")) || "--user=din").split("=")[1];
  const key = `${STATE_KEY}:${userId}`;
  const pool = mysql.createPool(poolOptionsFromUrl(loadEnvDatabaseUrl()));

  try {
    const [rows] = await pool.query("SELECT v FROM app_kv WHERE k = ? LIMIT 1", [key]);
    if (!rows?.[0]?.v) throw new Error(`state 없음: ${key}`);
    const state = JSON.parse(rows[0].v);
    const before = Array.isArray(state.donors) ? state.donors : [];
    const { donors, dropped } = dedupeDonorList(before);
    const beforeSum = before.reduce((a, d) => a + (Number(d.amount) || 0), 0);
    const afterSum = donors.reduce((a, d) => a + (Number(d.amount) || 0), 0);
    const summary = {
      dryRun,
      userId,
      before: before.length,
      after: donors.length,
      dropped: dropped.length,
      beforeMan: +(beforeSum / 10000).toFixed(2),
      afterMan: +(afterSum / 10000).toFixed(2),
      droppedSample: dropped.slice(0, 20).map((d) => ({
        id: d.id,
        name: d.name,
        amount: d.amount,
        at: d.at,
      })),
    };
    console.log(JSON.stringify(summary, null, 2));
    fs.writeFileSync(
      "tmp-dedupe-donors-report.json",
      JSON.stringify({ summary, dropped }, null, 2)
    );

    if (apply) {
      let next = { ...state, donors, updatedAt: Date.now() };
      next = syncMembers(next);
      await pool.query(
        `INSERT INTO app_kv (k, v, updated_at) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE v = VALUES(v), updated_at = VALUES(updated_at)`,
        [key, JSON.stringify(next), next.updatedAt]
      );
      console.log(`APPLIED donors ${before.length} → ${donors.length}`);
      console.log("다음: pm2 restart youtube --update-env");
    } else {
      console.log("dry-run — 적용: --apply");
    }
  } finally {
    await pool.end();
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]).includes("dedupe-donors-state");

if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
