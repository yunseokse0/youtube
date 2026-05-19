/**
 * Git에 push된 /images/sigs/from-drive 파일 중 서버 sigInventory에 없는 항목만 롤링에 추가.
 *
 *   node scripts/add-new-bundled-sigs.mjs
 *   BASE_URL=http://3.35.3.126 USER=finalent node scripts/add-new-bundled-sigs.mjs
 */
import fs from "fs/promises";
import path from "path";
import { bundledFromDriveImageUrl } from "./lib/local-sig-ocr.mjs";

const BASE_URL = (process.env.BASE_URL || "http://3.35.3.126").replace(/\/$/, "");
const USER = process.env.USER_ID || process.env.USER || "finalent";
const FROM_DRIVE = path.join(process.cwd(), "public", "images", "sigs", "from-drive");
const ALLOWED = /\.(gif|png|webp|jpe?g)$/i;
const SKIP = /\/(dummy-sig\.svg|stamp\.(svg|png|gif|webp))$/i;

function pathKey(p) {
  return String(p || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .toLowerCase();
}

function fileBaseKey(urlOrPath) {
  const s = pathKey(urlOrPath);
  return s.split("/").filter(Boolean).pop() || "";
}

function collectUsed(state) {
  const paths = new Set();
  const bases = new Set();
  const add = (raw) => {
    const u = String(raw || "").trim();
    if (!u) return;
    paths.add(pathKey(u));
    const b = fileBaseKey(u);
    if (b) bases.add(b);
  };
  for (const item of state?.sigInventory || []) {
    add(item.imageUrl);
  }
  const sr = state?.sigRolling;
  if (sr && typeof sr === "object" && Array.isArray(sr.items)) {
    for (const row of sr.items) add(row?.url);
  }
  add(state?.sigSoldOutStampUrl);
  return { paths, bases };
}

function filterFresh(bundledPaths, used) {
  return bundledPaths.filter((p) => {
    const norm = String(p || "").trim();
    if (!norm.startsWith("/images/sigs/")) return false;
    if (SKIP.test(norm)) return false;
    if (used.paths.has(pathKey(norm))) return false;
    const base = fileBaseKey(norm);
    if (base && used.bases.has(base)) return false;
    return true;
  });
}

async function listDiskPaths() {
  let names = [];
  try {
    names = await fs.readdir(FROM_DRIVE);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (!ALLOWED.test(name)) continue;
    out.push(bundledFromDriveImageUrl(name));
  }
  out.sort((a, b) => a.localeCompare(b, "ko"));
  return out;
}

async function fetchState() {
  const res = await fetch(`${BASE_URL}/api/state?u=${encodeURIComponent(USER)}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GET /api/state ${res.status}`);
  return res.json();
}

async function postState(body) {
  const res = await fetch(`${BASE_URL}/api/state?u=${encodeURIComponent(USER)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST /api/state ${res.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    return { ok: true };
  }
}

function appendToInventory(state, paths) {
  const existingIds = new Set((state.sigInventory || []).map((x) => x.id));
  const meta = { ...(state.sigRollingMeta || {}) };
  const nextInventory = [...(state.sigInventory || [])];
  let orderBase = nextInventory.filter((x) => x.isRolling).length;

  for (let i = 0; i < paths.length; i++) {
    const url = paths[i];
    const base = url.split("/").filter(Boolean).pop() || "sig";
    const label = base.replace(/\.[^.]+$/, "");
    let id = `sig_roll_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 8)}`;
    while (existingIds.has(id)) {
      id = `sig_roll_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 8)}`;
    }
    existingIds.add(id);
    nextInventory.push({
      id,
      name: label || `롤링 시그 ${i + 1}`,
      price: 0,
      imageUrl: url,
      memberId: "",
      maxCount: 1,
      soldCount: 0,
      isRolling: true,
      isActive: true,
    });
    meta[id] = { label: label || "", order: orderBase + i };
  }

  return {
    sigInventory: nextInventory,
    sigRollingMeta: meta,
    updatedAt: Date.now(),
    donorRankingsUpdatedAt: Date.now(),
  };
}

async function main() {
  const diskPaths = await listDiskPaths();
  console.log(`디스크 from-drive: ${diskPaths.length}개`);
  const remote = await fetchState();
  const used = collectUsed(remote);
  const fresh = filterFresh(diskPaths, used);
  if (!fresh.length) {
    console.log("추가할 신규 시그 없음 (이미 인벤에 있거나 경로 중복).");
    return;
  }
  console.log(`신규 ${fresh.length}개 추가 예정:\n${fresh.map((p) => `  ${p}`).join("\n")}`);
  const body = appendToInventory(remote, fresh);
  const res = await postState(body);
  console.log(
    `저장 완료 — sigInventory ${body.sigInventory.length}개 (신규 +${fresh.length})`,
    res.updatedAt ? `updatedAt=${res.updatedAt}` : ""
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
