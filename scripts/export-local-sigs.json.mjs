#!/usr/bin/env node
/**
 * 라이브 sigInventory 만으로 public/data/local-sigs.json 생성
 * (from-drive 스캔·OCR 병합 없음)
 *
 * 사용:
 *   npm run sig:export-catalog
 *   data/sig-inventory-live.json (EC2에서 scp) 우선
 *   BASE_URL=http://127.0.0.1:3000 USER=finalent npm run sig:export-catalog
 */
import fs from "fs/promises";
import path from "path";

const ROOT = process.cwd();
const OUT_JSON = path.join(ROOT, "public", "data", "local-sigs.json");
const LIVE_JSON =
  process.env.SIG_CATALOG_STATE_JSON ||
  path.join(ROOT, "data", "sig-inventory-live.json");

const BASE_URL = (
  process.env.SIG_CATALOG_BASE_URL ||
  process.env.SIG_OCR_BASE_URL ||
  process.env.BASE_URL ||
  "http://3.35.3.126"
).replace(/\/$/, "");
const USER =
  process.env.SIG_CATALOG_USER ||
  process.env.SIG_OCR_USER ||
  process.env.USER_ID ||
  process.env.USER ||
  "finalent";

function fileNameFromImageUrl(imageUrl) {
  const raw = String(imageUrl || "").trim();
  if (!raw) return "";
  const fromDrive = raw.match(/\/from-drive\/([^?#]+)/i);
  if (fromDrive?.[1]) {
    try {
      return decodeURIComponent(fromDrive[1]);
    } catch {
      return fromDrive[1];
    }
  }
  try {
    const u = raw.startsWith("http") ? new URL(raw) : new URL(raw, "http://local");
    return decodeURIComponent(path.basename(u.pathname));
  } catch {
    return path.basename(raw.split("?")[0] || raw);
  }
}

function toAbsoluteImageUrl(imageUrl, baseUrl) {
  const raw = String(imageUrl || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = String(baseUrl || "").replace(/\/$/, "");
  if (base && raw.startsWith("/")) return `${base}${raw}`;
  return raw;
}

function normalizeLiveRows(inv) {
  return inv
    .filter((x) => x && typeof x === "object" && String(x.name || "").trim())
    .map((x) => ({
      id: String(x.id || "").trim(),
      name: String(x.name || "").trim(),
      price: Math.max(0, Math.floor(Number(x.price) || 0)),
      imageUrl: String(x.imageUrl || "").trim(),
    }));
}

async function loadLiveFromJsonFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  const data = JSON.parse(raw);
  const inv = Array.isArray(data)
    ? data
    : Array.isArray(data?.sigInventory)
      ? data.sigInventory
      : null;
  if (!inv) {
    throw new Error(`${filePath}: sigInventory 배열이 없습니다`);
  }
  const imageBaseUrl = String(data?.baseUrl || "").trim() || BASE_URL;
  return { inventory: normalizeLiveRows(inv), imageBaseUrl };
}

async function fetchLiveSigInventory() {
  const q = new URLSearchParams({ u: USER, pick: "sigInventory" });
  const url = `${BASE_URL}/api/state?${q.toString()}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`GET ${url} → HTTP ${res.status}`);
  }
  const data = await res.json();
  const inv = Array.isArray(data?.sigInventory) ? data.sigInventory : [];
  return { inventory: normalizeLiveRows(inv), imageBaseUrl: BASE_URL };
}

async function resolveLiveSigInventory() {
  let fileMsg = "스냅샷 없음";
  try {
    const fromFile = await loadLiveFromJsonFile(LIVE_JSON);
    if (fromFile.inventory.length > 0) {
      return {
        ...fromFile,
        via: "file",
        detail: path.relative(ROOT, LIVE_JSON),
        error: null,
      };
    }
    fileMsg = `${path.relative(ROOT, LIVE_JSON)} 비어 있음`;
  } catch (e) {
    fileMsg = e instanceof Error ? e.message : String(e);
  }
  try {
    const fromApi = await fetchLiveSigInventory();
    return {
      ...fromApi,
      via: "api",
      detail: `${BASE_URL} (u=${USER})`,
      error: null,
    };
  } catch (apiErr) {
    const apiMsg = apiErr instanceof Error ? apiErr.message : String(apiErr);
    return {
      inventory: [],
      imageBaseUrl: BASE_URL,
      via: "none",
      detail: null,
      error: `파일: ${fileMsg} · API: ${apiMsg}`,
    };
  }
}

function buildCatalogItems(liveInventory, imageBaseUrl) {
  return liveInventory.map((inv) => {
    const file = fileNameFromImageUrl(inv.imageUrl) || inv.imageUrl;
    const imageUrl = toAbsoluteImageUrl(inv.imageUrl, imageBaseUrl);
    return {
      id: inv.id || `live_${file}`,
      name: inv.name,
      price: inv.price,
      category: "",
      file,
      imageUrl,
      imageUrlStored: inv.imageUrl,
      priceSource: "live",
      liveSigId: inv.id,
    };
  });
}

async function main() {
  const liveLoad = await resolveLiveSigInventory();
  const { inventory, imageBaseUrl, via, detail, error } = liveLoad;

  if (!inventory.length) {
    console.error("[sig:export-catalog] 라이브 sigInventory 가 없습니다.");
    if (error) console.error(`  ${error}`);
    console.error(
      `  EC2에서 스냅샷 저장 후 PC로 복사: data/sig-inventory-live.json\n` +
        `  또는 BASE_URL=... USER=finalent npm run sig:export-catalog`
    );
    process.exit(1);
  }

  const items = buildCatalogItems(inventory, imageBaseUrl);
  items.sort((a, b) => {
    const dp = (a.price || 0) - (b.price || 0);
    if (dp !== 0) return dp;
    return a.name.localeCompare(b.name, "ko");
  });

  await fs.mkdir(path.dirname(OUT_JSON), { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    source: "live sigInventory only",
    imageBaseUrl,
    live: {
      via,
      source: detail,
      baseUrl: BASE_URL,
      user: USER,
      snapshotPath: path.relative(ROOT, LIVE_JSON),
      inventoryCount: inventory.length,
      fetchError: error,
    },
    count: items.length,
    items,
  };
  await fs.writeFile(OUT_JSON, JSON.stringify(payload, null, 2), "utf8");
  console.log(
    `[sig:export-catalog] 라이브 ${items.length}개 → ${path.relative(ROOT, OUT_JSON)} (${via}: ${detail})`
  );
  console.log(`  이미지 기준 URL: ${imageBaseUrl}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
