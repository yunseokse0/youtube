/**
 * 로컬에서 POST /api/state → GET /api/state 반영 여부를 검증합니다.
 * 사용: node scripts/verify-local-sync.mjs [baseUrl]
 * 기본 baseUrl: http://127.0.0.1:3000
 */
const base = process.argv[2] || "http://127.0.0.1:3000";
const stateUrl = `${base}/api/state?u=finalent&user=finalent`;

async function main() {
  const r1 = await fetch(stateUrl);
  if (!r1.ok) {
    console.error("GET1 실패", r1.status, await r1.text());
    process.exit(1);
  }
  const j1 = await r1.json();
  const flip = j1.donationSyncMode === "sigSales" ? "mealBattle" : "sigSales";
  console.log("GET1", { donationSyncMode: j1.donationSyncMode, updatedAt: j1.updatedAt });

  const post = await fetch(`${base}/api/state`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ donationSyncMode: flip }),
  });
  const postBody = await post.text();
  console.log("POST", post.status, postBody.slice(0, 120));

  const r2 = await fetch(`${stateUrl}&_t=${Date.now()}`);
  if (!r2.ok) {
    console.error("GET2 실패", r2.status, await r2.text());
    process.exit(1);
  }
  const j2 = await r2.json();
  console.log("GET2", { donationSyncMode: j2.donationSyncMode, updatedAt: j2.updatedAt });

  const syncOk = j2.donationSyncMode === flip;
  console.log("SERVER_SYNC_OK", syncOk);

  const ov = await fetch(`${base}/overlay/sig-sales?u=finalent&adminPreviewEmbed=1`);
  console.log("OVERLAY_SIG_SALES_HTTP", ov.status);

  if (!syncOk) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
