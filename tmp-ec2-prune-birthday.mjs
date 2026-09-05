#!/usr/bin/env node
/** EC2 one-shot: keep xlsx birthday list only (din). Temp settlement prune. */
import fs from "fs";
import path from "path";
import mysql from "mysql2/promise";

const DELETE_IDS = new Set(["bank:sms:cmtk8dzo100t75jsbq5lihyhx","bank:sms:cmtk825sw00sm5jsbvlpwfsy5","bank:sms:cmtk7yzfl00s55jsbns9uzor8","bank:sms:cmtk7qtrd00rk5jsbiaupmx3w","bank:sms:cmtk7pj3300r15jsbiw394uw7","bank:sms:cmtk69qii00qk5jsbp16uts19","bank:sms:cmtk63scb00o45jsbolozdfn2","bank:sms:cmtk63kn300nz5jsbxlqbw9yp","bank:sms:cmtk63clw00nq5jsb4xt3nv5n","bank:sms:cmtk5yg2900mq5jsbiwtstxtp","bank:sms:cmtk5w90q00m15jsbxkblzob7","bank:sms:cmtk5do4x00jv5jsbqos10usu","bank:sms:cmtk4tor700ir5jsbsakvmtq0","bank:sms:cmtk4rman00ia5jsb4w3m76vl","bank:sms:cmtk4mts300ht5jsbvff9psgc","bank:sms:cmtk461wi00h05jsbjxpz9ysd","bank:sms:cmtk441wr00ge5jsb1vnygtd0","bank:sms:cmtk3fgv500fx5jsbl3r4vayv","bank:sms:cmtk1uczb00dr5jsb26k169ei","bank:sms:cmtk1swme00d65jsbvbfvyo4m","bank:sms:cmtk1q9of00c55jsbxkw8f36s","bank:sms:cmtk1c3v600845jsb9ggmxmwa","bank:sms:cmtk1b8f8007c5jsbaf3r7xai","bank:sms:cmtk1ax8200735jsbmyziexx8","bank:sms:cmtk155qw00525jsbj8izrp9d","bank:sms:cmtk0w5eu003d5jsbq3gtdtx5","bank:sms:cmtk0kctw000v5jsbxxvgnkdc","bank:sms:cmtk0jy4i000m5jsbf6jvi912","toonation:fp-40000-8gqoc-1788348368178-40000-1-s4fye5","bank:sms:cmtk0fyh700055jsb463fo3by","pdf:toonation:1788279810000:10012:자키집쓰볼탱69","toonation:fp-14600-fb6i1b-1788277630620-14600-1-xqiit7","bank:sms:cmtitxeid03qr5j1uew22wvjr","pdf:toonation:1788274804000:10012:딱기둘","pdf:toonation:1788273290000:10012:딱기둘","pdf:toonation:1788271665000:1009:딱기둘","pdf:toonation:1788265429000:1001:딱기둘","pdf:toonation:1788263420000:10050:딱기둘","pdf:toonation:1788263388000:10050:꽉꽉tv원이","pdf:toonation:1788263365000:10030:딱기둘"]);
const STATE_KEY = "excel-broadcast-state-v1:din";

function loadUrl() {
  const raw = fs.readFileSync(path.resolve(".env"), "utf8");
  const line = raw.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
  if (!line) throw new Error("no DATABASE_URL");
  return line.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
}

function poolOpts(raw) {
  const u = new URL(raw);
  const database = decodeURIComponent(u.pathname.replace(/^\//, "").split("/")[0] || "");
  return {
    user: decodeURIComponent(u.username || ""),
    password: decodeURIComponent(u.password || ""),
    database,
    connectTimeout: 15000,
    socketPath: "/var/run/mysqld/mysqld.sock",
  };
}

function sync(state) {
  const totals = new Map();
  for (const m of state.members || []) totals.set(m.id, { account: 0, toon: 0, contribution: 0 });
  for (const d of state.donors || []) {
    if (d?.excludedFromTotals) continue;
    const id = String(d.memberId || "");
    if (!id || !totals.has(id)) continue;
    const b = totals.get(id);
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
      return { ...m, ...b };
    }),
  };
}

const apply = process.argv.includes("--apply");
const url = loadUrl();
const pool = mysql.createPool(poolOpts(url));
const [rows] = await pool.query("SELECT v FROM app_kv WHERE k = ? LIMIT 1", [STATE_KEY]);
if (!rows?.[0]?.v) throw new Error("state missing");
const state = JSON.parse(rows[0].v);
const before = state.donors || [];
const removed = before.filter((d) => DELETE_IDS.has(String(d.id)));
const kept = before.filter((d) => !DELETE_IDS.has(String(d.id)));
const next = sync({ ...state, donors: kept, updatedAt: Date.now() });
console.log(
  JSON.stringify(
    {
      apply,
      before: before.length,
      removed: removed.length,
      after: kept.length,
      beforeSum: before.reduce((a, d) => a + Number(d.amount || 0), 0),
      afterSum: kept.reduce((a, d) => a + Number(d.amount || 0), 0),
      removedSample: removed.slice(0, 20).map((d) => d.name + ":" + d.amount),
    },
    null,
    2
  )
);
if (apply) {
  await pool.query(
    "INSERT INTO app_kv (k, v, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v), updated_at = VALUES(updated_at)",
    [STATE_KEY, JSON.stringify(next), next.updatedAt]
  );
  console.log("APPLIED");
} else {
  console.log("dry-run — pass --apply to write");
}
await pool.end();
