#!/usr/bin/env node
/**
 * 라이브 /api/state 의 sigInventory 만 data/sig-inventory-live.json 에 저장.
 * 이후 npm run sig:export-catalog 가 이름·가격에 이 파일을 우선 사용.
 *
 *   BASE_URL=http://3.35.3.126 USER=finalent node scripts/pull-sig-inventory-snapshot.mjs
 *   BASE_URL=http://localhost:3000 USER=finalent node scripts/pull-sig-inventory-snapshot.mjs
 */
import fs from "fs/promises";
import path from "path";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "data", "sig-inventory-live.json");
const BASE_URL = (
  process.env.SIG_CATALOG_BASE_URL ||
  process.env.BASE_URL ||
  "http://3.35.3.126"
).replace(/\/$/, "");
const USER =
  process.env.SIG_CATALOG_USER ||
  process.env.USER_ID ||
  process.env.USER ||
  "finalent";

async function main() {
  const q = new URLSearchParams({ u: USER, pick: "sigInventory" });
  const url = `${BASE_URL}/api/state?${q.toString()}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`GET ${url} → HTTP ${res.status}`);
  }
  const data = await res.json();
  const inv = Array.isArray(data?.sigInventory) ? data.sigInventory : [];
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  const payload = {
    pulledAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    user: USER,
    sigInventory: inv,
  };
  await fs.writeFile(OUT, JSON.stringify(payload, null, 2), "utf8");
  console.log(`[pull-sig-inventory] ${inv.length}개 → ${path.relative(ROOT, OUT)}`);
  console.log("다음: npm run sig:export-catalog");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
