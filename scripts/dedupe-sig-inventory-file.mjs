#!/usr/bin/env node
/**
 * data/sig-inventory-live.json 중복 제거 → npm run sig:export-catalog
 *
 *   npm run sig:dedupe-file
 *   node scripts/dedupe-sig-inventory-file.mjs imageUrl
 */
import fs from "fs/promises";
import path from "path";

const ROOT = process.cwd();
const LIVE_JSON = path.join(ROOT, "data", "sig-inventory-live.json");
const ONE_SHOT_SIG_ID = "sig_one_shot";

function normalizeSigDedupKeyImageUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return "__empty_image__";
  try {
    if (s.startsWith("http://") || s.startsWith("https://")) {
      const u = new URL(s);
      const p = u.pathname.replace(/\/+$/, "") || "/";
      return `${u.origin}${p}`.toLowerCase();
    }
  } catch {
    /* noop */
  }
  return s.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function normalizeSigDedupKeyName(raw) {
  const n = String(raw || "")
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();
  return n || "__empty_name__";
}

function normalizeSigDedupKeyNamePrice(name, price) {
  const n = String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
  const p = Math.max(0, Math.floor(Number(price) || 0));
  return `${n}|${p}`;
}

function dedupeSigInventory(inventory, strategy) {
  const seenUrl = new Set();
  const seenName = new Set();
  const seenNamePrice = new Set();
  const out = [];
  let removedCount = 0;

  for (const item of inventory) {
    if (item.id === ONE_SHOT_SIG_ID) {
      out.push(item);
      continue;
    }
    if (strategy === "imageUrl") {
      const urlKey = normalizeSigDedupKeyImageUrl(item.imageUrl);
      const nameKey = normalizeSigDedupKeyName(item.name);
      if (seenUrl.has(urlKey) || seenName.has(nameKey)) {
        removedCount++;
        continue;
      }
      seenUrl.add(urlKey);
      seenName.add(nameKey);
      out.push(item);
      continue;
    }
    const key = normalizeSigDedupKeyNamePrice(item.name, item.price);
    if (seenNamePrice.has(key)) {
      removedCount++;
      continue;
    }
    seenNamePrice.add(key);
    out.push(item);
  }

  return { nextInventory: out, removedCount };
}

async function main() {
  const strategy = process.argv[2] === "imageUrl" ? "imageUrl" : "nameAndPrice";
  const raw = await fs.readFile(LIVE_JSON, "utf8");
  const data = JSON.parse(raw);
  const inv = Array.isArray(data?.sigInventory) ? data.sigInventory : [];
  const before = inv.length;
  const { nextInventory, removedCount } = dedupeSigInventory(inv, strategy);
  if (removedCount <= 0) {
    console.log(`[sig:dedupe-file] 중복 없음 (${before}개, strategy=${strategy})`);
    return;
  }
  const payload = {
    ...data,
    dedupedAt: new Date().toISOString(),
    dedupeStrategy: strategy,
    sigInventory: nextInventory,
  };
  await fs.writeFile(LIVE_JSON, JSON.stringify(payload, null, 2), "utf8");
  console.log(
    `[sig:dedupe-file] ${before} → ${nextInventory.length} (삭제 ${removedCount}, strategy=${strategy})`
  );
  console.log(`  → ${path.relative(ROOT, LIVE_JSON)}`);
  console.log("다음: npm run sig:export-catalog");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
