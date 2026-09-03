#!/usr/bin/env node
/**
 * 생일 xlsx 중복 행(동일 at·금액·닉)이 서버에 1건만 있는 「에겐」1만×2 추가
 *   - pdf:toonation:1788261859000:10000:에겐  (xlsx 2행 / live 1)
 *   - pdf:toonation:1788267250000:10000:에겐  (xlsx 2행 / live 1)
 *
 *   cd ~/youtube && node scripts/add-missing-egen-2.mjs
 *   cd ~/youtube && node scripts/add-missing-egen-2.mjs --apply
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mysql from "mysql2/promise";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATE_KEY = "excel-broadcast-state-v1:din";
const JAKI_NAME = "자키";

/**
 * xlsx 에 동일 id 가 2번 나오는데 live 는 1번만 있는 건.
 * 두 번째 복사본은 id 접미사 #2 로 추가 (동일 id 충돌 방지).
 */
const MISSING_DUP_COPIES = [
  {
    baseId: "pdf:toonation:1788261859000:10000:에겐",
    at: 1788261859000,
    amount: 10000,
    nick: "에겐",
    atKst: "2026-09-01 20:24:19",
  },
  {
    baseId: "pdf:toonation:1788267250000:10000:에겐",
    at: 1788267250000,
    amount: 10000,
    nick: "에겐",
    atKst: "2026-09-01 21:54:10",
  },
];

function loadEnvDatabaseUrl() {
  const envPath = path.join(ROOT, ".env");
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

function syncMemberTotals(state) {
  const members = Array.isArray(state.members) ? state.members : [];
  const totals = new Map(members.map((m) => [String(m.id), { account: 0, toon: 0, contribution: 0 }]));
  for (const d of state.donors || []) {
    const memberId = String(d.memberId || "").trim();
    if (!memberId || !totals.has(memberId)) continue;
    const amount = Number(d.amount) || 0;
    const bucket = totals.get(memberId);
    if ((d.target || "account") === "toon") bucket.toon += amount;
    else bucket.account += amount;
    const cp = Number(d.contributionPoints);
    bucket.contribution += Number.isFinite(cp) ? cp : Math.floor(amount / 10);
  }
  return {
    ...state,
    members: members.map((m) => {
      const t = totals.get(String(m.id)) || { account: 0, toon: 0, contribution: 0 };
      return { ...m, account: t.account, toon: t.toon, contribution: t.contribution };
    }),
  };
}

function countIdFamily(donors, baseId) {
  const b = String(baseId);
  return donors.filter((d) => {
    const id = String(d.id || "");
    return id === b || id === `${b}#2` || id.startsWith(`${b}#`);
  }).length;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const pool = mysql.createPool(poolOptionsFromUrl(loadEnvDatabaseUrl()));
  try {
    const [rows] = await pool.query("SELECT v FROM app_kv WHERE k = ? LIMIT 1", [STATE_KEY]);
    const raw = rows?.[0]?.v;
    if (!raw) throw new Error(`state 없음: ${STATE_KEY}`);
    let state = JSON.parse(raw);
    const donors = Array.isArray(state.donors) ? [...state.donors] : [];
    const jaki =
      (state.members || []).find((m) => String(m.name || "").includes(JAKI_NAME)) ||
      (state.members || [])[0];
    if (!jaki?.id) throw new Error("자키 멤버 없음");

    const toAdd = [];
    for (const row of MISSING_DUP_COPIES) {
      const n = countIdFamily(donors, row.baseId);
      if (n >= 2) {
        console.log(`skip already have ${n}: ${row.baseId}`);
        continue;
      }
      if (n < 1) {
        console.warn(`WARN base missing, will still add #2: ${row.baseId}`);
      }
      toAdd.push(row);
    }

    if (!toAdd.length) {
      const sum = donors.reduce((a, d) => a + (Number(d.amount) || 0), 0);
      console.log(
        JSON.stringify(
          { ok: true, added: 0, donors: donors.length, sum, man: +(sum / 10000).toFixed(2) },
          null,
          2
        )
      );
      return;
    }

    const resetAt = Number(state.settlementResetAt || 0);
    const baseAt = Math.max(Date.now(), resetAt + 1);
    const created = toAdd.map((row, i) => ({
      id: `${row.baseId}#2`,
      name: row.nick,
      amount: row.amount,
      at: resetAt > 0 ? baseAt + i : row.at,
      target: "toon",
      memberId: jaki.id,
      contributionPoints: Math.floor(row.amount / 10),
      message: `xlsx duplicate copy (${row.atKst})`,
    }));

    const nextDonors = [...donors, ...created];
    const now = Date.now();
    let next = syncMemberTotals({
      ...state,
      donors: nextDonors,
      updatedAt: now,
    });

    const beforeSum = donors.reduce((a, d) => a + (Number(d.amount) || 0), 0);
    const afterSum = nextDonors.reduce((a, d) => a + (Number(d.amount) || 0), 0);
    console.log(
      JSON.stringify(
        {
          dryRun: !apply,
          note: "xlsx had duplicate identical rows; adding #2 copies",
          added: created.map((d) => ({ id: d.id, name: d.name, amount: d.amount, at: d.at })),
          before: { donors: donors.length, sum: beforeSum, man: +(beforeSum / 10000).toFixed(2) },
          after: { donors: nextDonors.length, sum: afterSum, man: +(afterSum / 10000).toFixed(2) },
        },
        null,
        2
      )
    );

    if (!apply) {
      console.log("dry-run — 적용: node scripts/add-missing-egen-2.mjs --apply");
      return;
    }

    next = { ...next, donors: nextDonors };
    const json = JSON.stringify(next);
    const rev = Number(next.updatedAt) || Date.now();
    await pool.query(
      `INSERT INTO app_kv (k, v, updated_at) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE v = VALUES(v), updated_at = VALUES(updated_at)`,
      [STATE_KEY, json, rev]
    );
    console.log(`APPLIED ${STATE_KEY} donors=${next.donors.length} updatedAt=${next.updatedAt}`);

    const port = process.env.PORT || "3000";
    const reloadUrl = `http://127.0.0.1:${port}/api/ops/reload-state-from-kv?user=din`;
    try {
      const res = await fetch(reloadUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await res.text();
      console.log(`reload-state-from-kv HTTP ${res.status} ${body.slice(0, 300)}`);
    } catch (e) {
      console.warn(`reload 실패 — pm2 restart youtube: ${e && e.message ? e.message : e}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
