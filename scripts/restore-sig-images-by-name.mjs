#!/usr/bin/env node
/**
 * 시그 인벤토리 imageUrl 을 siggif / from-drive 원본 파일명(시그 이름)으로 복구.
 * 일괄 업로드 순서 매칭 버그로 잘못 붙은 /uploads/sigs/… URL 을 교체합니다.
 *
 *   node scripts/restore-sig-images-by-name.mjs
 *   BASE_URL=http://3.37.61.130 USER=finalent node scripts/restore-sig-images-by-name.mjs
 *   node scripts/restore-sig-images-by-name.mjs --dry-run
 *   node scripts/restore-sig-images-by-name.mjs --all   # 잘못된 배치만이 아니라 이름 매칭 전부
 */
import fs from "fs/promises";
import path from "path";

const ROOT = process.cwd();
const SIGGIF = path.join(ROOT, "siggif");
const FROM_DRIVE = path.join(ROOT, "public", "images", "sigs", "from-drive");
const ONE_SHOT_ID = "sig_one_shot";

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const restoreAll = argv.includes("--all");
const BASE_URL = (
  process.env.SIG_RESTORE_BASE_URL ||
  process.env.BASE_URL ||
  "http://3.37.61.130"
).replace(/\/$/, "");
const USER =
  process.env.SIG_RESTORE_USER || process.env.USER_ID || process.env.USER || "finalent";

/** 일괄 업로드로 연속 저장된 타임스탬프 구간(오매칭 배치) */
const WRONG_BATCH_RANGES = [
  [1780146972000, 1780146974500],
  [1779276811736, 1779276813600],
];

const EXTS = [".gif", ".GIF", ".png", ".PNG", ".webp", ".WEBP", ".jpg", ".jpeg"];

function normalizeNameKey(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[_-]+/g, "");
}

async function findSourceFile(sigName) {
  const base = String(sigName || "").trim();
  if (!base) return null;
  for (const dir of [SIGGIF, FROM_DRIVE]) {
    for (const ext of EXTS) {
      const p = path.join(dir, `${base}${ext}`);
      try {
        const st = await fs.stat(p);
        if (st.isFile()) return { path: p, fileName: `${base}${ext}` };
      } catch {
        /* next */
      }
    }
  }
  return null;
}

function isWrongBatchUploadUrl(imageUrl) {
  const m = String(imageUrl || "").match(/\/uploads\/sigs\/[^/]+\/(\d+)_/i);
  if (!m?.[1]) return false;
  const ts = Number(m[1]);
  return WRONG_BATCH_RANGES.some(([lo, hi]) => ts >= lo && ts <= hi);
}

function bundledFromDriveUrl(fileName) {
  const parts = String(fileName).split("/").map((p) => encodeURIComponent(p));
  return `/images/sigs/from-drive/${parts.join("/")}`;
}

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text.slice(0, 500) };
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${url} → ${JSON.stringify(data)}`);
  }
  return data;
}

async function uploadSigFile(filePath, fileName) {
  const buf = await fs.readFile(filePath);
  const fd = new FormData();
  const blob = new Blob([buf], { type: fileName.toLowerCase().endsWith(".png") ? "image/png" : "image/gif" });
  fd.append("file", blob, fileName);
  const q = new URLSearchParams({ user: USER, u: USER, skipMirror: "1" });
  const url = `${BASE_URL}/api/upload/sig-image?${q}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "x-user-id": USER, "x-sig-upload-skip-mirror": "1" },
    body: fd,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok || !j.url) {
    throw new Error(`upload failed ${fileName}: ${res.status} ${j.error || ""}`);
  }
  return String(j.url).trim();
}

async function main() {
  const stateUrl = `${BASE_URL}/api/state?${new URLSearchParams({ u: USER, pick: "sigInventory" })}`;
  const data = await fetchJson(stateUrl, { headers: { Accept: "application/json" } });
  const inventory = Array.isArray(data?.sigInventory) ? data.sigInventory : [];
  if (!inventory.length) {
    console.error("sigInventory 가 비어 있습니다.");
    process.exit(1);
  }

  const plans = [];
  for (const item of inventory) {
    if (!item?.id || item.id === ONE_SHOT_ID) continue;
    const name = String(item.name || "").trim();
    const src = await findSourceFile(name);
    if (!src) continue;
    const needs =
      restoreAll || isWrongBatchUploadUrl(item.imageUrl) || !String(item.imageUrl || "").trim();
    if (!needs) continue;
    plans.push({ item, src });
  }

  console.log(`[restore] 서버: ${BASE_URL}  계정: ${USER}`);
  console.log(`[restore] 대상 ${plans.length}건 (${restoreAll ? "전체 이름매칭" : "오매칭 배치만"})`);
  if (!plans.length) {
    console.log("복구할 항목이 없습니다. siggif/ 또는 from-drive/ 에 「시그이름.gif」가 있는지 확인하세요.");
    return;
  }

  if (dryRun) {
    for (const { item, src } of plans) {
      console.log(`  ${item.name} ← ${path.relative(ROOT, src.path)}  (현재 ${item.imageUrl})`);
    }
    return;
  }

  let ok = 0;
  const nextInventory = inventory.map((row) => ({ ...row }));
  const byId = new Map(nextInventory.map((x) => [x.id, x]));

  for (const { item, src } of plans) {
    try {
      let newUrl;
      try {
        newUrl = await uploadSigFile(src.path, src.fileName);
      } catch (uploadErr) {
        console.warn(`  업로드 실패 → from-drive 경로 사용: ${item.name} (${uploadErr.message})`);
        newUrl = bundledFromDriveUrl(src.fileName);
      }
      const row = byId.get(item.id);
      if (row) {
        row.imageUrl = newUrl;
        row.isActive = true;
        row.isRolling = true;
      }
      ok += 1;
      console.log(`  ✓ ${item.name} → ${newUrl}`);
    } catch (e) {
      console.error(`  ✗ ${item.name}:`, e.message || e);
    }
  }

  const postUrl = `${BASE_URL}/api/state?${new URLSearchParams({ u: USER })}`;
  await fetchJson(postUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-user-id": USER,
    },
    body: JSON.stringify({
      sigInventory: nextInventory,
      updatedAt: Date.now(),
    }),
  });

  console.log(`[restore] 완료: ${ok}/${plans.length}건 imageUrl 갱신 후 POST /api/state`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
