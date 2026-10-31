const fs = require("fs");
const path = require("path");

function loadEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

const env = { ...loadEnv(path.join(__dirname, ".env")), ...loadEnv(path.join(__dirname, ".env.local")) };
const secret = String(process.env.TOONA_INGEST_SECRET || env.TOONA_INGEST_SECRET || "").trim();
const base = String(process.env.INGEST_BASE || "http://127.0.0.1:3011");
const COUNT = Number(process.env.INGEST_COUNT || 8010);
if (!secret) {
  console.log(JSON.stringify({ ok: false, error: "missing_ingest_secret" }));
  process.exit(1);
}

const userId = "ingestcaptest";
const stamp = Date.now();

async function post(id, amount) {
  const res = await fetch(`${base}/api/donations/ingest?u=${userId}&applyExcel=true`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: `bank:din:${id}`,
      provider: "bank",
      externalId: id,
      donorName: "한도점검",
      playerName: "한도점검",
      amount,
      message: "cap-test",
      target: "account",
      at: new Date(stamp).toISOString(),
      status: "queued",
    }),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json };
}

(async () => {
  const statuses = {};
  let first503 = null;
  let lastOk = null;
  const conc = Math.max(1, Number(process.env.INGEST_CONC || 8));
  let next = 0;
  async function worker() {
    while (true) {
      const i = next;
      next += 1;
      if (i >= COUNT) break;
      const out = await post(`cap-${stamp}-${i}`, 1000);
      statuses[out.status] = (statuses[out.status] || 0) + 1;
      if (out.status === 503 && first503 == null) first503 = { i, error: out.json && out.json.error };
      if (out.status === 200) lastOk = { i, depth: out.json && out.json.queueDepth, dup: out.json && out.json.duplicateQueued };
    }
  }
  await Promise.all(Array.from({ length: conc }, () => worker()));
  const dup = await post(`cap-${stamp}-0`, 1000);
  const probe8000 = await post(`cap-${stamp}-0`, 1000);
  console.log(
    JSON.stringify({
      ok: !first503 && (statuses[200] || 0) === COUNT,
      count: COUNT,
      statuses,
      first503,
      lastOk,
      duplicate: { status: dup.status, duplicateQueued: dup.json && dup.json.duplicateQueued, depth: dup.json && dup.json.queueDepth },
      secondDup: { status: probe8000.status, duplicateQueued: probe8000.json && probe8000.duplicateQueued },
    })
  );
})().catch((err) => {
  console.log(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err) }));
  process.exit(1);
});
