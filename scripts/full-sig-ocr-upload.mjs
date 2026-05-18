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
  return {
    limit: limitIdx >= 0 ? Number(process.argv[limitIdx + 1]) : 0,
    retryFailures: process.argv.includes("--retry-failures"),
  };
}

function normName(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
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
  const { limit, retryFailures } = parseArgs();
  const speed = resolveOcrSpeed();
  const resultsPath = path.join(process.cwd(), "sig-ocr-results.json");

  const remote = await fetchState();
  let remoteInv = Array.isArray(remote.sigInventory) ? remote.sigInventory : [];

  let files = listGifs(limit);
  if (retryFailures) {
    const prev = JSON.parse(fs.readFileSync(resultsPath, "utf8"));
    files = (prev.results || [])
      .filter((r) => !r.price || Number(r.price) <= 0)
      .map((r) => String(r.file || "").trim())
      .filter((f) => f && fs.existsSync(path.join(DEFAULT_SIG_GIF_DIR, f)));
    console.log(`실패분 재시도 ${files.length}건 · 모드=${speed}`);
  } else {
    console.log(
      `OCR 대상 ${files.length}개 · 모드=${speed} (${speed === "fast" ? "빠름, 기본" : "정밀 --full"})`
    );
  }

  const invByName = new Map(remoteInv.map((x) => [normName(x.name), x]));

  const t0 = Date.now();
  const { workers, modes, terminate } = await createLocalSigOcrWorkers(speed);
  const resultRows = [];
  let ok = 0;
  let fail = 0;
  try {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fp = path.join(DEFAULT_SIG_GIF_DIR, file);
      process.stderr.write(`[${i + 1}/${files.length}] ${file} …\r`);
      const price = await detectGifFile(workers, modes, fp, speed);
      const name = file.replace(/\.gif$/i, "");
      const hit = matchSigInventoryItemByFileName(remoteInv, file) || invByName.get(normName(name));
      const item = hit
        ? { ...hit }
        : buildItemFromFile(file, price);
      const finalPrice = applySigNamePriceFallback(name, price);
      if (finalPrice != null && finalPrice > 0) {
        item.price = finalPrice;
        ok++;
      } else {
        fail++;
      }
      invByName.set(normName(item.name), item);
      resultRows.push({
        file,
        sigId: item.id,
        sigName: item.name,
        price: item.price || 0,
        imageUrl: item.imageUrl,
      });
    }
    process.stderr.write("\n");
  } finally {
    await terminate();
  }

  const inventory = [...invByName.values()];
  const sigRollingMeta = { ...(remote.sigRollingMeta || {}) };
  inventory.forEach((item, idx) => {
    if (!sigRollingMeta[item.id]) {
      sigRollingMeta[item.id] = { label: item.name, order: idx };
    }
  });

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const withPrice = inventory.filter((x) => Number(x.price) > 0).length;
  console.log(
    `OCR 이번 ${ok}/${files.length} · 서버 시그 ${inventory.length}개(금액 ${withPrice}개) · ${elapsed}s → 업로드`
  );
  const res = await postState({
    sigInventory: inventory,
    sigRollingMeta,
    updatedAt: Date.now(),
  });
  console.log("저장 완료", res.updatedAt ? `updatedAt=${res.updatedAt}` : "");

  let allResults = resultRows;
  if (retryFailures && fs.existsSync(resultsPath)) {
    const prev = JSON.parse(fs.readFileSync(resultsPath, "utf8"));
    const byFile = new Map((prev.results || []).map((r) => [r.file, r]));
    for (const r of resultRows) byFile.set(r.file, r);
    allResults = [...byFile.values()];
  }

  fs.writeFileSync(
    resultsPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        baseUrl: BASE_URL,
        user: USER,
        speed,
        summary: {
          ok: allResults.filter((r) => r.price > 0).length,
          fail: allResults.filter((r) => !r.price).length,
          total: allResults.length,
        },
        results: allResults,
      },
      null,
      2
    ),
    "utf8"
  );
  console.log(`결과: ${resultsPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
