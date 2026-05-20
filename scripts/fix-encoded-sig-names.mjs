/**
 * sigInventory/sigRollingMeta의 퍼센트 인코딩된 한글 라벨 복구.
 *
 * 사용:
 *   node scripts/fix-encoded-sig-names.mjs
 *   BASE_URL=http://3.35.3.126 USER_ID=finalent node scripts/fix-encoded-sig-names.mjs
 */

const BASE_URL = (process.env.BASE_URL || "http://3.35.3.126").replace(/\/$/, "");
const USER = process.env.USER_ID || process.env.USER || "finalent";

function safeDecodeURIComponent(s) {
  try {
    return decodeURIComponent(String(s || ""));
  } catch {
    return String(s || "");
  }
}

function decodePercentDeep(raw) {
  let out = String(raw || "");
  for (let i = 0; i < 4; i++) {
    if (!/%[0-9a-f]{2}/i.test(out)) break;
    const next = safeDecodeURIComponent(out);
    if (next === out) break;
    out = next;
  }
  return out;
}

function decodeSigLabel(raw) {
  const s = String(raw || "");
  if (!/%[0-9a-f]{2}/i.test(s)) return s;
  return decodePercentDeep(s);
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

async function main() {
  const state = await fetchState();
  const inv = Array.isArray(state.sigInventory) ? state.sigInventory : [];
  const meta = state.sigRollingMeta && typeof state.sigRollingMeta === "object" ? { ...state.sigRollingMeta } : {};

  let fixedInv = 0;
  const nextInv = inv.map((item) => {
    const before = String(item?.name || "");
    const after = decodeSigLabel(before);
    if (before !== after) {
      fixedInv += 1;
      return { ...item, name: after };
    }
    return item;
  });

  let fixedMeta = 0;
  for (const [id, row] of Object.entries(meta)) {
    if (!row || typeof row !== "object") continue;
    const before = String(row.label || "");
    const after = decodeSigLabel(before);
    if (before !== after) {
      fixedMeta += 1;
      meta[id] = { ...row, label: after };
    }
  }

  if (!fixedInv && !fixedMeta) {
    console.log("복구할 인코딩 라벨이 없습니다.");
    return;
  }

  const payload = {
    sigInventory: nextInv,
    sigRollingMeta: meta,
    updatedAt: Date.now(),
  };
  const res = await postState(payload);
  console.log(`복구 완료: sigInventory ${fixedInv}건, sigRollingMeta ${fixedMeta}건`, res.updatedAt ? `updatedAt=${res.updatedAt}` : "");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

