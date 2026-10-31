const HUB = "http://13.125.221.195:4000";
const SK = "sk_probe_not_real";

async function hit(label, url, opts = {}) {
  try {
    const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(8000) });
    const text = await r.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 160) };
    }
    console.log(
      JSON.stringify({
        label,
        status: r.status,
        err: body && body.error,
        keys: body && typeof body === "object" ? Object.keys(body) : [],
      })
    );
  } catch (e) {
    console.log(JSON.stringify({ label, error: String(e.message || e).slice(0, 100) }));
  }
}

(async () => {
  await hit("sig GET noauth", `${HUB}/api/signatures/${encodeURIComponent(SK)}`);
  await hit("sig GET bearer-s2s", `${HUB}/api/signatures/${encodeURIComponent(SK)}`, {
    headers: { Authorization: "Bearer s2s-ingest" },
  });
  await hit("formula POST noauth", `${HUB}/api/youtubegit/sync/contribution-formula`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: "x", streamKey: SK, accountWeightPct: 50, toonWeightPct: 50 }),
  });
  await hit("formula POST bearer-s2s", `${HUB}/api/youtubegit/sync/contribution-formula`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer s2s-ingest" },
    body: JSON.stringify({ userId: "x", streamKey: SK, accountWeightPct: 50, toonWeightPct: 50 }),
  });
})();
