#!/usr/bin/env node
/**
 * siggif / from-drive 에 「시그이름.gif」가 있으면
 * data/sig-inventory-live.json 의 imageUrl 을 from-drive 경로로 맞춤 (로컬 카탈로그용)
 *
 *   npm run sig:link-siggif-local
 *   npm run sig:link-siggif-local -- --dry-run
 */
import fs from "fs/promises";
import path from "path";

const ROOT = process.cwd();
const LIVE_JSON = path.join(ROOT, "data", "sig-inventory-live.json");
const SIGGIF = path.join(ROOT, "siggif");
const FROM_DRIVE = path.join(ROOT, "public", "images", "sigs", "from-drive");
const EXTS = [".gif", ".GIF", ".png", ".PNG", ".webp"];
const dryRun = process.argv.includes("--dry-run");

async function findSourceFile(sigName) {
  const base = String(sigName || "").trim();
  if (!base) return null;
  for (const dir of [SIGGIF, FROM_DRIVE]) {
    for (const ext of EXTS) {
      const p = path.join(dir, `${base}${ext}`);
      try {
        const st = await fs.stat(p);
        if (st.isFile()) return { fileName: `${base}${ext}` };
      } catch {
        /* next */
      }
    }
  }
  return null;
}

function bundledFromDriveUrl(fileName) {
  return `/images/sigs/from-drive/${encodeURIComponent(fileName)}`;
}

async function main() {
  const raw = await fs.readFile(LIVE_JSON, "utf8");
  const data = JSON.parse(raw);
  const inv = Array.isArray(data?.sigInventory) ? data.sigInventory : [];
  let changed = 0;
  for (const item of inv) {
    const name = String(item?.name || "").trim();
    const src = await findSourceFile(name);
    if (!src) continue;
    const next = bundledFromDriveUrl(src.fileName);
    if (String(item.imageUrl || "").trim() === next) continue;
    console.log(`${dryRun ? "[dry-run] " : ""}${name}: ${item.imageUrl} → ${next}`);
    if (!dryRun) item.imageUrl = next;
    changed += 1;
  }
  if (!changed) {
    console.log("변경 없음. siggif/ 또는 from-drive/ 에 「모찌.gif」 등 파일을 넣은 뒤 다시 실행하세요.");
    return;
  }
  if (!dryRun) {
    data.sigInventory = inv;
    data.linkedFromSiggifAt = new Date().toISOString();
    await fs.writeFile(LIVE_JSON, JSON.stringify(data, null, 2), "utf8");
    console.log(`[sig:link-siggif-local] ${changed}건 갱신 → data/sig-inventory-live.json`);
    console.log("다음: npm run sig:export-catalog");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
