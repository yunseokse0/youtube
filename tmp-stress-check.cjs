"use strict";
const fs = require("fs");
const path = require("path");

function loadEnvFile(p) {
  const out = {};
  if (!fs.existsSync(p)) return out;
  const text = fs.readFileSync(p, "utf8");
  for (const raw of text.split(/\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    let k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function ident(id) {
  const s = String(id || "").trim();
  return s.replace(/^(bank:sms:|bank:din:|bank:push:|toonation:din:|toonation:)/i, "");
}

function nick(d) {
  return String(d.displayNickname || d.nickname || d.name || d.donorName || "").trim();
}

function amt(d) {
  return Math.round(Number(d.amount) || 0);
}

function atMs(d) {
  const v = d.createdAt || d.at || d.ts || d.time || d.timestamp;
  const n = typeof v === "number" ? v : Date.parse(v || "");
  return Number.isFinite(n) ? n : 0;
}

function isStressRow(d) {
  const n = nick(d);
  const msg = String(d.message || d.memo || "").trim();
  return (
    /버스트-동일인|박자키|김삼성|박멱등|김멱등|PREFLIGHT|__PREFLIGHT/i.test(n) ||
    /0\.5초동안 동일후원자|동일인 교차|CASE C cross|멱등성 warmup|프로덕션 멱등성|preflight/i.test(msg) ||
    /^(A-N_|TN-N_|N_|TNBURST_|TNA_|TNB_|TNDUPE_|IDEM_)/.test(n) ||
    /TNBURST_|TNA_|TNB_|TNDUPE_|IDEM_/.test(String(d.id || d.externalId || ""))
  );
}

async function fetchJson(url, headers = {}, timeoutMs = 20000) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = { _raw: text.slice(0, 180) };
    }
    return { ok: res.ok, status: res.status, ms: Date.now() - t0, json };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, json: { error: String(e.message || e).slice(0, 160) } };
  }
}

async function pullHubDonations({ hub, streamKey, secret, fromMs }) {
  const rows = [];
  let after = "";
  let pages = 0;
  let lastStatus = 0;
  let lastErr = null;
  while (pages < 30) {
    pages += 1;
    const params = new URLSearchParams({ sort: "asc", limit: "200" });
    if (fromMs > 0) params.set("fromMs", String(fromMs));
    if (after) params.set("after", after);
    const url = `${hub}/api/donations/${encodeURIComponent(streamKey)}?${params}`;
    const r = await fetchJson(url, {
      Accept: "application/json",
      Authorization: `Bearer ${secret}`,
    });
    lastStatus = r.status;
    if (!r.ok) {
      lastErr = r.json?.error || r.json?._raw || `HTTP ${r.status}`;
      break;
    }
    const list = r.json?.donations || r.json?.items || r.json?.rows || (Array.isArray(r.json) ? r.json : []);
    if (!Array.isArray(list) || list.length === 0) break;
    rows.push(...list);
    if (list.length < 200) break;
    after = String(list[list.length - 1]?.id || "").trim();
    if (!after) break;
  }
  return { rows, pages, lastStatus, lastErr, total: rTotal(rows) };
}

function rTotal(rows) {
  const j = arguments[1];
  return Array.isArray(rows) ? rows.length : 0;
}

(async () => {
  const ytEnv = {
    ...loadEnvFile("C:\\youtube\\.env"),
    ...loadEnvFile("C:\\youtube\\.env.local"),
  };
  const toonaEnv = {
    ...loadEnvFile("C:\\toona\\backend\\.env"),
    ...loadEnvFile("C:\\toona\\backend\\.env.local"),
  };
  let stress = {};
  const stressPath = "C:\\toona\\backend\\scripts\\_stress-env.json";
  if (fs.existsSync(stressPath)) {
    try {
      stress = JSON.parse(fs.readFileSync(stressPath, "utf8"));
    } catch {}
  }

  const YT = (process.env.YOUTUBE_URL || ytEnv.NEXT_PUBLIC_APP_URL || "http://3.37.127.90").replace(/\/$/, "");
  const HUB = (process.env.TOONA_API_BASE_URL || ytEnv.TOONA_API_BASE_URL || "http://13.125.221.195:4000").replace(
    /\/$/,
    ""
  );
  const secret = String(ytEnv.TOONA_INGEST_SECRET || toonaEnv.YOUTUBE_GIT_INGEST_SECRET || "").trim();
  const users = ["paeza", "din", "finalent"];
  const fromMs = Date.parse("2026-10-11T13:00:00.000Z"); // 22:00 KST

  const healthYt = await fetchJson(`${YT}/api/health`, {}, 8000);
  const healthHub = await fetchJson(`${HUB}/api/health`, {}, 8000);

  const ytStates = {};
  for (const u of users) {
    const r = await fetchJson(`${YT}/api/state?u=${u}&pick=donors`, {}, 25000);
    const donors =
      r.json?.state?.donors ||
      r.json?.donors ||
      r.json?.appState?.donors ||
      [];
    const list = Array.isArray(donors) ? donors : [];
    const tonight = list.filter((d) => atMs(d) >= fromMs);
    const stressRows = list.filter(isStressRow);
    ytStates[u] = {
      status: r.status,
      ms: r.ms,
      keys: r.json && typeof r.json === "object" ? Object.keys(r.json).slice(0, 20) : [],
      donors: list.length,
      tonight: tonight.length,
      stress: stressRows.length,
      stressNicks: [...new Set(stressRows.map(nick))].slice(0, 12),
      tonightSample: tonight
        .slice(-8)
        .map((d) => ({ n: nick(d), a: amt(d), t: atMs(d) })),
    };
  }

  const hubSessions = {};
  for (const u of users) {
    const r = await fetchJson(`${YT}/api/toona/hub?u=${u}`, {}, 15000);
    const sess = r.json?.session || {};
    const logs = r.json?.logs || r.json?.donationLogs || [];
    hubSessions[u] = {
      status: r.status,
      linked: Boolean(sess.streamKey),
      streamKeyPrefix: sess.streamKey ? String(sess.streamKey).slice(0, 6) : "",
      logs: Array.isArray(logs) ? logs.length : 0,
      logSample: Array.isArray(logs)
        ? logs.slice(-5).map((x) => ({
            t: x.ts || x.at || x.time,
            m: String(x.message || x.msg || x.text || x.kind || "").slice(0, 80),
          }))
        : [],
      err: r.json?.error || null,
    };
  }

  const streamKey = String(stress.STREAM_KEY || "").trim() || null;
  // Prefer paeza live session streamKey without printing it
  const paezaKeyWait = await fetchJson(`${YT}/api/toona/hub?u=paeza`, {}, 15000);
  const liveKey = String(paezaKeyWait.json?.session?.streamKey || "").trim();
  const key = streamKey || liveKey;

  let hubPull = { rows: [], lastStatus: 0, lastErr: "no_key", pages: 0 };
  if (key && secret) {
    hubPull = await pullHubDonations({ hub: HUB, streamKey: key, secret, fromMs: 0 });
  } else {
    hubPull.lastErr = !key ? "no_stream_key" : "no_ingest_secret";
  }

  const hubAll = hubPull.rows;
  const hubTonight = hubAll.filter((d) => atMs(d) >= fromMs);
  const hubStress = hubAll.filter(isStressRow);

  const excel = ytStates.paeza;
  const excelDonorsResp = await fetchJson(`${YT}/api/state?u=paeza`, {}, 25000);
  const excelDonors =
    excelDonorsResp.json?.state?.donors ||
    excelDonorsResp.json?.donors ||
    excelDonorsResp.json?.appState?.donors ||
    [];
  const excelList = Array.isArray(excelDonors) ? excelDonors : [];
  const excelIds = new Set(excelList.map((d) => ident(d.id || d.externalId || d.donorKey)));
  const hubIds = hubStress.map((d) => ident(d.id));
  const missingInExcel = hubStress.filter((d) => !excelIds.has(ident(d.id)));
  const excelStress = excelList.filter(isStressRow);
  const excelStressIds = excelStress.map((d) => ident(d.id || d.externalId));
  const extraInExcel = excelStress.filter((d) => !hubIds.includes(ident(d.id || d.externalId)));

  const idCounts = {};
  for (const d of excelStress) {
    const id = ident(d.id || d.externalId);
    if (!id) continue;
    idCounts[id] = (idCounts[id] || 0) + 1;
  }
  const dups = Object.entries(idCounts).filter(([, n]) => n > 1);

  console.log(
    JSON.stringify(
      {
        health: {
          yt: { status: healthYt.status, ok: healthYt.json?.ok ?? healthYt.ok, mysql: healthYt.json?.mysqlOk },
          hub: { status: healthHub.status, db: healthHub.json?.db ?? healthHub.json?.ok },
        },
        ytStates,
        hubSessions,
        hubPull: {
          lastStatus: hubPull.lastStatus,
          lastErr: hubPull.lastErr,
          pages: hubPull.pages,
          all: hubAll.length,
          tonight: hubTonight.length,
          stress: hubStress.length,
          stressNicks: [...new Set(hubStress.map(nick))].slice(0, 20),
          tonightSample: hubTonight.slice(-10).map((d) => ({
            n: nick(d),
            a: amt(d),
            t: atMs(d),
            src: d.source || d.channel,
          })),
        },
        compare: {
          excelCount: excelList.length,
          excelStress: excelStress.length,
          hubStress: hubStress.length,
          missingInExcel: missingInExcel.length,
          extraInExcel: extraInExcel.length,
          duplicateIds: dups.length,
          missingSample: missingInExcel.slice(0, 8).map((d) => ({ n: nick(d), a: amt(d), t: atMs(d) })),
        },
        hasSecret: Boolean(secret),
        hasKey: Boolean(key),
        keyPrefix: key ? key.slice(0, 6) : "",
      },
      null,
      2
    )
  );
})().catch((e) => {
  console.error(JSON.stringify({ fatal: String(e && e.message ? e.message : e).slice(0, 200) }));
  process.exit(1);
});
