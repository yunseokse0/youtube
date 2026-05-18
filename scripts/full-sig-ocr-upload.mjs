/**
 * 1) 로컬 from-drive GIF 전체 OCR
 * 2) 시그 인벤 복구·가격 반영 후 운영 서버 POST
 *
 * node scripts/full-sig-ocr-upload.mjs
 * node scripts/full-sig-ocr-upload.mjs --limit 5
 */
import fs from "fs";
import path from "path";
import {
  DEFAULT_SIG_GIF_DIR,
  applySigNamePriceFallback,
  bundledFromDriveImageUrl,
  createLocalSigOcrWorkers,
  detectGifFile,
  matchSigInventoryItemByFileName,
  resolveOcrSpeed,
} from "./lib/local-sig-ocr.mjs";

const BASE_URL = (process.env.SIG_OCR_BASE_URL || "https://youtube-5g1a.onrender.com").replace(/\/$/, "");
const USER = process.env.SIG_OCR_USER || "finalent";
const ONE_SHOT_SIG_ID = "sig_one_shot";

function parseArgs() {
  const limitIdx = process.argv.indexOf("--limit");
  return { limit: limitIdx >= 0 ? Number(process.argv[limitIdx + 1]) : 0 };
}

function listGifs(limit) {
  let files = fs
    .readdirSync(DEFAULT_SIG_GIF_DIR)
    .filter((f) => f.toLowerCase().endsWith(".gif"))
    .sort();
  if (limit > 0) files = files.slice(0, limit);
  return files;
}

function buildItemFromFile(file, price) {
  const name = file.replace(/\.gif$/i, "");
  const p = applySigNamePriceFallback(name, price);
  return {
    id: `sig_fd_${Buffer.from(name, "utf8").toString("hex").slice(0, 24)}`,
    name,
    price: p != null ? p : 0,
    imageUrl: bundledFromDriveImageUrl(file),
    memberId: "",
    maxCount: 1,
    soldCount: 0,
    isRolling: true,
    isActive: true,
  };
}

async function fetchState() {
  const res = await fetch(`${BASE_URL}/api/state?u=${encodeURIComponent(USER)}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GET state ${res.status}`);
  return res.json();
}

async function postState(body) {
  const res = await fetch(`${BASE_URL}/api/state?u=${encodeURIComponent(USER)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST state ${res.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    return { ok: true };
  }
}

async function main() {
  const { limit } = parseArgs();
  const speed = resolveOcrSpeed();
  const files = listGifs(limit);
  console.log(
    `OCR 대상 ${files.length}개 · 모드=${speed} (${speed === "fast" ? "빠름, 기본" : "정밀 --full"})`
  );

  const remote = await fetchState();
  const remoteInv = Array.isArray(remote.sigInventory) ? remote.sigInventory : [];
  const oneShot = remoteInv.find((x) => x?.id === ONE_SHOT_SIG_ID);

  const t0 = Date.now();
  const { workers, modes, terminate } = await createLocalSigOcrWorkers(speed);
  const built = [];
  let ok = 0;
  let fail = 0;
  try {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fp = path.join(DEFAULT_SIG_GIF_DIR, file);
      process.stderr.write(`[${i + 1}/${files.length}] ${file} …\r`);
      const price = await detectGifFile(workers, modes, fp, speed);
      const item = buildItemFromFile(file, price);
      const hit = matchSigInventoryItemByFileName(remoteInv, file);
      if (hit?.id) item.id = hit.id;
      if (hit?.soldCount != null) item.soldCount = hit.soldCount;
      if (hit?.memberId) item.memberId = hit.memberId;
      if (price != null) ok++;
      else fail++;
      built.push(item);
    }
    process.stderr.write("\n");
  } finally {
    await terminate();
  }

  const inventory = oneShot ? [oneShot, ...built] : built;
  const sigRollingMeta = { ...(remote.sigRollingMeta || {}) };
  built.forEach((item, idx) => {
    if (!sigRollingMeta[item.id]) {
      sigRollingMeta[item.id] = { label: item.name, order: idx };
    }
  });

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `OCR 성공 ${ok} / 실패 ${fail} · ${elapsed}s (평균 ${(Number(elapsed) / Math.max(1, files.length)).toFixed(1)}s/건) → 서버 반영 (${inventory.length}개 시그)`
  );
  const res = await postState({
    sigInventory: inventory,
    sigRollingMeta,
    updatedAt: Date.now(),
  });
  console.log("저장 완료", res.updatedAt ? `updatedAt=${res.updatedAt}` : "");

  const out = path.join(process.cwd(), "sig-ocr-results.json");
  fs.writeFileSync(
    out,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        baseUrl: BASE_URL,
        user: USER,
        summary: { ok, fail, total: files.length },
        results: built.map((item) => ({
          file: `${item.name}.gif`,
          sigId: item.id,
          sigName: item.name,
          price: item.price,
          imageUrl: item.imageUrl,
        })),
      },
      null,
      2
    ),
    "utf8"
  );
  console.log(`결과: ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
