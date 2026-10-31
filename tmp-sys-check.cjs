const LIVE = "http://3.37.127.90";
const HUB = "http://13.125.221.195:4000";
const LOCAL = "http://127.0.0.1:3001";
const tmo = 10000;

function pickHealth(j) {
  if (!j || typeof j !== "object") return j;
  const o = {
    ok: j.ok,
    kvConfigured: j.kvConfigured,
    redisConfigured: j.redisConfigured,
    redisOk: j.redisOk,
    mysqlOk: j.mysqlOk,
    mysqlConnMode: j.mysqlConnMode,
  };
  if (j.kvError) o.kvError = String(j.kvError).slice(0, 80);
  return o;
}

async function hit(label, url, opts = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), tmo);
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      ...opts,
      signal: ac.signal,
      redirect: "manual",
      headers: { Accept: "application/json,text/html,*/*", ...(opts.headers || {}) },
    });
    const ms = Date.now() - t0;
    const ct = r.headers.get("content-type") || "";
    const text = await r.text();
    let body = null;
    if (/json/i.test(ct) || text.startsWith("{") || text.startsWith("[")) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { raw: text.slice(0, 120) };
      }
    } else {
      body = {
        html: /<html/i.test(text),
        len: text.length,
        title: (text.match(/<title>([^<]+)/i) || [])[1] || null,
      };
    }
    return { label, status: r.status, ms, body };
  } catch (e) {
    return { label, status: 0, ms: Date.now() - t0, error: String(e.name || e.message || e).slice(0, 100) };
  } finally {
    clearTimeout(timer);
  }
}

function donorSummary(j) {
  const d = j.state || j;
  const donors = Array.isArray(d.donors) ? d.donors : [];
  const by = {};
  for (const row of donors) {
    const p = String(row.provider || "none");
    by[p] = (by[p] || 0) + 1;
  }
  const ats = donors.map((x) => Number(x.at) || 0).filter((n) => n > 0);
  const last = ats.length ? Math.max(...ats) : 0;
  const reset = Number(d.settlementResetAt) || 0;
  const after = reset ? donors.filter((x) => Number(x.at) > reset).length : donors.length;
  const inv = Array.isArray(d.sigInventory) ? d.sigInventory : [];
  const mem = Array.isArray(d.members) ? d.members : [];
  return {
    donorCount: donors.length,
    byProvider: by,
    members: mem.length,
    sigs: inv.length,
    rolling: inv.filter((x) => x && x.isRolling).length,
    lastDonorAt: last ? new Date(last).toISOString() : null,
    lastKst: last ? new Date(last + 9 * 3600 * 1000).toISOString().replace("Z", "+09") : null,
    settlementResetAt: reset ? new Date(reset).toISOString() : null,
    afterReset: after,
    updatedAt: d.updatedAt ? new Date(Number(d.updatedAt)).toISOString() : null,
    hasId: donors.filter((x) => String(x.id || x.externalId || "").length > 4).length,
  };
}

function hubPub(j) {
  const s = j && j.session;
  if (!s) {
    return {
      ok: j && j.ok,
      scenario: j && j.scenario,
      disabled: j && j.disabled,
      error: j && j.error,
      linked: false,
    };
  }
  return {
    ok: j.ok,
    scenario: j.scenario,
    disabled: !!j.disabled,
    linked: true,
    hasStreamKey: Boolean(s.streamKey),
    lastStatusOk: s.lastStatusOk ?? null,
    lastIngestOk: s.lastIngestOk ?? null,
    lastIngestAt: s.lastIngestAt || null,
    lastStatusAt: s.lastStatusAt || null,
    lastStatusError: s.lastStatusError || null,
    lastIngestError: s.lastIngestError || null,
    youtubegitEnabled: s.youtubegitEnabled ?? null,
    linkedAt: s.linkedAt || null,
    logs: Array.isArray(j.logs) ? j.logs.length : Array.isArray(j.donationLogs) ? j.donationLogs.length : 0,
  };
}

function slim(x) {
  const b = x.body;
  let body = b;
  if (x.label.includes("state") && b && (b.state || b.donors || b.updatedAt)) body = donorSummary(b);
  if (x.label.includes("hub session")) body = hubPub(b);
  if (x.label.includes("deep") || x.label.includes("health")) body = pickHealth(b) || b;
  if (x.label.includes("A ingest") && b) body = { skipped: b.skipped, mode: b.mode, error: b.error };
  if (x.label.includes("ingest noauth") && b) body = { error: b.error || b.message, skipped: b.skipped };
  return { label: x.label, status: x.status, ms: x.ms, error: x.error, body };
}

(async () => {
  const out = {};
  out.liveHealth = await hit("live health", LIVE + "/api/health");
  out.liveDeep = await hit("live deep", LIVE + "/api/health?deep=1");
  out.liveAdmin = await hit("live admin", LIVE + "/admin");
  out.liveOverlay = await hit("live overlay", LIVE + "/overlay/sig-sales?u=din");
  out.liveState = await hit("live state", LIVE + "/api/state?u=din");
  out.liveIngestNoAuth = await hit("live ingest noauth", LIVE + "/api/donations/ingest?u=din", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  out.liveAIngest = await hit("live A ingest skip", LIVE + "/api/donations/toonation/ingest?u=din", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw: "x" }),
  });
  out.liveHub = await hit("live hub session", LIVE + "/api/toona/hub?u=din");
  out.hubRoot = await hit("din hub", HUB + "/");
  out.hubHealth = await hit("din hub health", HUB + "/api/health");
  out.localHealth = await hit("local health", LOCAL + "/api/health");
  out.localDeep = await hit("local deep", LOCAL + "/api/health?deep=1");
  out.localState = await hit("local state", LOCAL + "/api/state?u=finalent");
  out.localIngest = await hit("local ingest noauth", LOCAL + "/api/donations/ingest?u=finalent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  console.log(JSON.stringify(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, slim(v)])), null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
