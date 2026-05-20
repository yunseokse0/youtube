/**
 * 서버 sigInventory 중복 정리:
 * - 이름(공백 제거/소문자) 또는 이미지 URL(pathname 기준)이 겹치면 하나만 남김
 * - 같은 키 충돌 시 가격이 더 큰 항목 우선, 동점이면 기존 순서 우선
 *
 * 사용:
 *   node scripts/dedupe-sig-inventory.mjs
 *   BASE_URL=http://3.35.3.126 USER_ID=finalent node scripts/dedupe-sig-inventory.mjs
 */

const BASE_URL = (process.env.BASE_URL || "http://3.35.3.126").replace(/\/$/, "");
const USER = process.env.USER_ID || process.env.USER || "finalent";
const ONE_SHOT_SIG_ID = "sig_one_shot";

function normalizeNameKey(raw) {
  return String(raw || "")
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();
}

function normalizeImageKey(raw) {
  const s = String(raw || "").trim();
  if (!s) return "__empty_image__";
  try {
    if (s.startsWith("http://") || s.startsWith("https://")) {
      const u = new URL(s);
      const p = u.pathname.replace(/\/+$/, "") || "/";
      return `${u.origin}${p}`.toLowerCase();
    }
  } catch {
    /* ignore */
  }
  return s.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function sigScore(item) {
  return Math.max(0, Number(item?.price || 0));
}

function chooseBetter(a, b) {
  const sa = sigScore(a);
  const sb = sigScore(b);
  if (sb > sa) return b;
  return a;
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

function dedupeInventory(inventory) {
  const byName = new Map();
  const byImage = new Map();
  const selected = [];
  const selectedById = new Map();

  const putOrReplace = (item, idx) => {
    const id = String(item?.id || "");
    const nameKey = normalizeNameKey(item?.name);
    const imgKey = normalizeImageKey(item?.imageUrl);

    const conflicts = new Set();
    if (nameKey && byName.has(nameKey)) conflicts.add(byName.get(nameKey));
    if (imgKey && byImage.has(imgKey)) conflicts.add(byImage.get(imgKey));

    if (!conflicts.size) {
      selected.push(item);
      selectedById.set(id, selected.length - 1);
      if (nameKey) byName.set(nameKey, id);
      if (imgKey) byImage.set(imgKey, id);
      return { added: 1, removed: 0 };
    }

    let keep = item;
    for (const cid of conflicts) {
      const oldIdx = selectedById.get(cid);
      if (oldIdx == null) continue;
      const old = selected[oldIdx];
      keep = chooseBetter(keep, old);
    }

    let removed = 0;
    for (const cid of conflicts) {
      const oldIdx = selectedById.get(cid);
      if (oldIdx == null) continue;
      const old = selected[oldIdx];
      if (keep === old) {
        removed += 1;
        continue;
      }
      // old 제거
      selected[oldIdx] = null;
      selectedById.delete(cid);
      removed += 1;
    }

    if (keep === item) {
      selected.push(item);
      selectedById.set(id, selected.length - 1);
      if (nameKey) byName.set(nameKey, id);
      if (imgKey) byImage.set(imgKey, id);
      return { added: 1, removed };
    }
    return { added: 0, removed };
  };

  let removed = 0;
  for (let i = 0; i < inventory.length; i++) {
    const item = inventory[i];
    if (!item || typeof item !== "object") continue;
    if (item.id === ONE_SHOT_SIG_ID) {
      selected.push(item);
      selectedById.set(item.id, selected.length - 1);
      continue;
    }
    const r = putOrReplace(item, i);
    removed += r.removed;
  }

  return { next: selected.filter(Boolean), removed };
}

async function main() {
  const state = await fetchState();
  const inv = Array.isArray(state.sigInventory) ? state.sigInventory : [];
  const before = inv.length;
  const { next, removed } = dedupeInventory(inv);
  if (!removed) {
    console.log(`중복 없음: ${before}개 유지`);
    return;
  }
  const payload = {
    sigInventory: next,
    sigRollingMeta: state.sigRollingMeta || {},
    updatedAt: Date.now(),
  };
  const res = await postState(payload);
  console.log(`중복 정리 완료: ${before} -> ${next.length} (삭제 ${removed})`, res.updatedAt ? `updatedAt=${res.updatedAt}` : "");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

