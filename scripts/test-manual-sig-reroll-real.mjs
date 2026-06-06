#!/usr/bin/env node
/**
 * 리얼 서버 수동 시그 리롤 — 설정 덮어쓰기 회귀 테스트
 *
 * EC2 내부(권장):
 *   cd ~/youtube && git pull && node scripts/test-manual-sig-reroll-real.mjs
 *
 * 원격(방화벽·80 허용 시):
 *   BASE_URL=http://13.124.114.125 USER=finalent node scripts/test-manual-sig-reroll-real.mjs
 *
 * --dry-run  GET만 (POST 생략)
 */
const MANUAL_SIG_DRAFT_STATE_KEY = "sigSalesManualDraftV1";
const MANUAL_OVERLAY_SESSION_ID = "manual_live";

const BASE_URL = (
  process.env.SIG_CATALOG_BASE_URL ||
  process.env.BASE_URL ||
  "http://127.0.0.1"
).replace(/\/$/, "");
const USER =
  process.env.SIG_CATALOG_USER ||
  process.env.USER_ID ||
  process.env.USER ||
  "finalent";
const DRY = process.argv.includes("--dry-run");

function snap(state) {
  return {
    members: Array.isArray(state.members) ? state.members.length : 0,
    memberNames: (state.members || []).slice(0, 3).map((m) => m?.name || m?.id),
    donors: Array.isArray(state.donors) ? state.donors.length : 0,
    donorTotal: (state.donors || []).reduce((s, d) => s + Number(d?.amount || 0), 0),
    overlayPresets: Array.isArray(state.overlayPresets) ? state.overlayPresets.length : 0,
    sigInventory: Array.isArray(state.sigInventory) ? state.sigInventory.length : 0,
    updatedAt: state.updatedAt || 0,
    roulettePhase: state.rouletteState?.phase || "",
    rouletteSession: state.rouletteState?.sessionId || "",
    selectedSigs: Array.isArray(state.rouletteState?.selectedSigs)
      ? state.rouletteState.selectedSigs.length
      : 0,
  };
}

async function getState() {
  const q = new URLSearchParams({ user: USER, u: USER, _t: String(Date.now()) });
  const res = await fetch(`${BASE_URL}/api/state?${q}`, { cache: "no-store" });
  const text = await res.text();
  if (!res.ok) throw new Error(`GET /api/state HTTP ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function postPatch(patch) {
  const q = new URLSearchParams({ user: USER, u: USER });
  const res = await fetch(`${BASE_URL}/api/state?${q}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST /api/state HTTP ${res.status}: ${text.slice(0, 400)}`);
  return text.trim() ? JSON.parse(text) : {};
}

function buildSimulatedRerollPatch(fullState) {
  const inv = Array.isArray(fullState.sigInventory) ? fullState.sigInventory : [];
  const pool = inv.filter(
    (x) =>
      x &&
      x.id !== "sig_one_shot" &&
      x.isActive !== false &&
      Number(x.soldCount || 0) < Number(x.maxCount || 1)
  );
  if (pool.length < 2) {
    throw new Error(`판매 가능 시그 ${pool.length}개 — 리롤 시뮬레이션 불가(2개 이상 필요)`);
  }
  const pick = pool.slice(0, Math.min(5, pool.length));
  const oneShotPrice = pick.reduce((s, x) => s + Number(x.price || 0), 0);
  const now = Date.now();
  const draft = {
    inputMode: "inventory",
    drafts: pick.map((s) => ({
      sourceSigId: s.id,
      name: s.name,
      priceInput: String(Math.floor(Number(s.price || 0))),
      imageUrl: String(s.imageUrl || ""),
    })),
    oneShotName: "한방 시그",
    oneShotPriceInput: String(oneShotPrice),
    oneShotImageUrl: "/images/sigs/한방시그.gif",
    sigSoldFlags: [false, false, false, false, false],
    oneShotMarkSold: false,
  };
  const next = {
    ...fullState,
    overlaySettings: {
      ...(fullState.overlaySettings && typeof fullState.overlaySettings === "object"
        ? fullState.overlaySettings
        : {}),
      [MANUAL_SIG_DRAFT_STATE_KEY]: draft,
    },
    rouletteState: {
      ...fullState.rouletteState,
      phase: "LANDED",
      isRolling: false,
      sessionId: MANUAL_OVERLAY_SESSION_ID,
      startedAt: now,
      selectedSigs: pick,
      results: pick,
      result: pick[pick.length - 1] || null,
      oneShotResult: { id: "sig_one_shot", name: "한방 시그", price: oneShotPrice },
      spinCount: pick.length,
      overlayReloadNonce: Number(fullState.rouletteState?.overlayReloadNonce || 0) + 1,
    },
    updatedAt: now,
  };
  return buildSigSalesManualApiPatch(next);
}

function buildSigSalesManualApiPatch(next) {
  const os =
    next.overlaySettings && typeof next.overlaySettings === "object" ? next.overlaySettings : {};
  const manualDraft = os[MANUAL_SIG_DRAFT_STATE_KEY];
  const patch = {
    updatedAt: next.updatedAt ?? Date.now(),
    sigInventory: next.sigInventory,
    sigSalesExcludedIds: next.sigSalesExcludedIds,
    sigSoldOutStampUrl: next.sigSoldOutStampUrl,
    sigRollingMeta: next.sigRollingMeta,
  };
  if (manualDraft && typeof manualDraft === "object") {
    patch.overlaySettings = { [MANUAL_SIG_DRAFT_STATE_KEY]: manualDraft };
  }
  if (next.rouletteState) {
    patch.rouletteState = next.rouletteState;
  }
  return patch;
}

function compare(before, after, label) {
  const issues = [];
  if (before.members !== after.members) {
    issues.push(`멤버 수 ${before.members} → ${after.members}`);
  }
  if (before.donors !== after.donors) {
    issues.push(`후원 건수 ${before.donors} → ${after.donors}`);
  }
  if (before.donorTotal !== after.donorTotal && before.donors > 0) {
    issues.push(`후원 합계 ${before.donorTotal} → ${after.donorTotal}`);
  }
  if (before.overlayPresets !== after.overlayPresets) {
    issues.push(`오버레이 프리셋 ${before.overlayPresets} → ${after.overlayPresets}`);
  }
  return issues;
}

async function main() {
  console.log(`[test-manual-sig-reroll] BASE_URL=${BASE_URL} USER=${USER}${DRY ? " (dry-run)" : ""}`);

  const beforeState = await getState();
  const before = snap(beforeState);
  console.log("[before]", JSON.stringify(before, null, 2));

  if (before.sigInventory < 2) {
    console.error("FAIL: 시그 재고 2개 미만 — 리롤 테스트 불가");
    process.exit(1);
  }

  const patch = buildSimulatedRerollPatch(beforeState);
  const patchKeys = Object.keys(patch);
  console.log("[patch keys]", patchKeys.join(", "));
  if ("members" in patch || "donors" in patch || "overlayPresets" in patch) {
    console.error("FAIL: 패치에 members/donors/overlayPresets 포함됨 (클라이언트 버그)");
    process.exit(1);
  }

  if (DRY) {
    console.log("OK (dry-run): GET·패치 구성만 검증");
    return;
  }

  const postResult = await postPatch(patch);
  console.log("[post]", JSON.stringify(postResult));

  await new Promise((r) => setTimeout(r, 800));
  const afterState = await getState();
  const after = snap(afterState);
  console.log("[after]", JSON.stringify(after, null, 2));

  const issues = compare(before, after, "reroll");
  if (issues.length) {
    console.error("FAIL: 리롤 PATCH 후 설정 변경됨:");
    for (const i of issues) console.error("  -", i);
    process.exit(1);
  }

  if (after.roulettePhase !== "LANDED" && after.selectedSigs === 0) {
    console.warn("WARN: 회전판 LANDED/selectedSigs 미반영 — OBS는 초안 폴백으로 표시될 수 있음");
  } else {
    console.log("OK: 회전판 LANDED 반영", after.selectedSigs, "개");
  }

  console.log("PASS: 수동 시그 리롤 PATCH — 멤버·후원·프리셋 유지");
}

main().catch((e) => {
  console.error("ERROR:", e.message || e);
  process.exit(1);
});
