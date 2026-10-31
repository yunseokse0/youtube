const HUB = "http://13.125.221.195:4000";

async function hit(label, url, opts = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(8000) });
    const text = await r.text();
    let body = text.slice(0, 300);
    try {
      body = JSON.parse(text);
    } catch {
      /* keep */
    }
    const err =
      body && typeof body === "object"
        ? body.error || body.message || body.reason || null
        : null;
    console.log(JSON.stringify({ label, status: r.status, ms: Date.now() - t0, err, keys: body && typeof body === "object" ? Object.keys(body) : typeof body }));
  } catch (e) {
    console.log(JSON.stringify({ label, status: 0, error: String(e.message || e).slice(0, 120) }));
  }
}

(async () => {
  await hit("yg GET noauth", `${HUB}/api/youtubegit/sk_probe_not_real`);
  await hit("yg PATCH noauth", `${HUB}/api/youtubegit/sk_probe_not_real`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true, scenario: "B" }),
  });
  await hit("yg PATCH bearer-s2s", `${HUB}/api/youtubegit/sk_probe_not_real`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: "Bearer s2s-ingest" },
    body: JSON.stringify({ enabled: true, scenario: "B" }),
  });
  await hit("donations GET noauth", `${HUB}/api/donations/sk_probe_not_real`);
  await hit("donations GET bearer-s2s", `${HUB}/api/donations/sk_probe_not_real`, {
    headers: { Authorization: "Bearer s2s-ingest" },
  });
})();
