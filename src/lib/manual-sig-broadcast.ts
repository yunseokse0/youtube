import type { AppState, SigItem } from "@/types";
import { resolveSigOverlayCardImageUrl } from "@/lib/constants";
import { buildOneShotFromSelected } from "@/lib/sig-one-shot-price";
import { pickRandomManualSigDrafts } from "@/lib/manual-sig-random";
import { listActiveManualSigPool } from "@/lib/manual-sig-active-pool";
import { MANUAL_OVERLAY_SESSION_ID } from "@/lib/sig-sales-manual-round";
import {
  MANUAL_SIG_DRAFT_STATE_KEY,
  manualSigDraftsReady,
  normalizeManualSigDraftPersist,
  parseManualSigDraftRows,
  type ManualSigDraft,
  type ManualSigDraftPersist,
} from "@/lib/manual-sig-workbench";
import {
  canonicalSigIdFromWheelSliceId,
  hydrateSigItemFromInventory,
  ONE_SHOT_SIG_ID,
} from "@/lib/sig-roulette";
import { stripBundledSigPlaceholderItems } from "@/lib/sig-placeholder";

export function readManualSigDraftFromState(
  state: AppState | null | undefined
): ManualSigDraftPersist | null {
  const os = state?.overlaySettings;
  if (!os || typeof os !== "object") return null;
  const raw = (os as Record<string, unknown>)[MANUAL_SIG_DRAFT_STATE_KEY];
  return normalizeManualSigDraftPersist(raw);
}

/** 수동·한방 OBS 카드용 — 인벤 `sig_one_shot` → 수동 초안 `oneShotImageUrl` → 당첨 폴백 */
export function resolveManualOneShotOverlayImageUrl(params: {
  state: AppState | null | undefined;
  selectedSigs: SigItem[];
  userId: string;
  oneShotName?: string;
}): string {
  const { state, selectedSigs, userId } = params;
  const label = String(params.oneShotName || "한방 시그").trim() || "한방 시그";
  const inv = state?.sigInventory || [];
  const oneShotItem = inv.find((item) => item.id === ONE_SHOT_SIG_ID);
  const fromInv = String(oneShotItem?.imageUrl || "").trim();
  if (fromInv) return resolveSigOverlayCardImageUrl(label, fromInv, userId);
  const draftImage = String(readManualSigDraftFromState(state)?.oneShotImageUrl || "").trim();
  if (draftImage) return resolveSigOverlayCardImageUrl(label, draftImage, userId);
  const pick = selectedSigs.find((x) => (x.imageUrl || "").trim());
  return resolveSigOverlayCardImageUrl(label, pick?.imageUrl?.trim() || "", userId);
}

/** OBS `memberId` 쿼리로 당첨 목록이 비지 않게 — 인벤 멤버 id는 덮어쓰지 않음 */
export function hydrateManualOverlaySigItem(
  item: SigItem,
  inventory: SigItem[] | undefined,
  userId?: string,
  draftRow?: Pick<ManualSigDraft, "imageUrl" | "sourceSigId">
): SigItem {
  const h = hydrateSigItemFromInventory(item, inventory, userId);
  const draftUrl = String(draftRow?.imageUrl || item.imageUrl || "").trim();
  const imageUrl = draftUrl || String(h.imageUrl || "").trim();
  return { ...h, memberId: "", imageUrl };
}

export function buildManualSigItemsFromDrafts(
  drafts: ReturnType<typeof pickRandomManualSigDrafts>,
  inventory: SigItem[] | undefined,
  userId: string
): SigItem[] {
  if (!drafts) return [];
  const rows = parseManualSigDraftRows(drafts);
  return rows.map((row, idx) => {
    const sourceSigId = String(drafts[idx]?.sourceSigId || "").trim();
    const safeName =
      row.name.replace(/\s+/g, "_").replace(/[^\w가-힣-]/g, "").slice(0, 24) || `sig_${idx + 1}`;
    const base: SigItem = {
      id: sourceSigId || `manual_${safeName}`,
      name: row.name,
      price: row.price,
      imageUrl: row.imageUrl,
      memberId: "",
      maxCount: 1,
      soldCount: 0,
      isRolling: true,
      isActive: true,
    };
    return hydrateManualOverlaySigItem(base, inventory, userId, drafts[idx]);
  });
}

const MIN_MANUAL_OVERLAY_SIGS = 2;

/** 수동 OBS — 서버 LANDED 당첨 + 초안 폴백(리롤 직후 pick 지연 대비) */
export function resolveManualOverlaySelectedSigs(
  state: AppState | null | undefined,
  userId: string
): SigItem[] {
  if (!state?.rouletteState) return [];
  const rs = state.rouletteState;
  const raw = (
    Array.isArray(rs.selectedSigs) && rs.selectedSigs.length > 0
      ? rs.selectedSigs
      : Array.isArray(rs.results)
        ? rs.results
        : []
  ) as SigItem[];
  const inv = state.sigInventory || [];
  const draft = readManualSigDraftFromState(state);
  const draftRows = Array.isArray(draft?.drafts) ? draft!.drafts : [];
  let items = stripBundledSigPlaceholderItems(
    raw.map((s, idx) => hydrateManualOverlaySigItem(s, inv, userId, draftRows[idx]))
  );
  if (items.length < MIN_MANUAL_OVERLAY_SIGS && draft && manualSigDraftsReady(draft.drafts)) {
    items = stripBundledSigPlaceholderItems(
      buildManualSigItemsFromDrafts(draft.drafts, inv, userId)
    );
  }
  return items.slice(0, 5);
}

/** 관리자 「판매완료」체크 → OBS 스탬프 (localStorage 없음) */
export function buildManualOverlaySoldOverrideSet(
  state: AppState | null | undefined,
  selected: SigItem[],
  userId: string
): Set<string> {
  const next = new Set<string>();
  const draft = readManualSigDraftFromState(state);
  if (!draft) return next;
  const flags = Array.isArray(draft.sigSoldFlags) ? draft.sigSoldFlags : [];
  const hasFlags = flags.some(Boolean) || Boolean(draft.oneShotMarkSold);
  if (!hasFlags) return next;
  const normalizeNameKey = (raw: string) =>
    String(raw || "").trim().toLowerCase().replace(/\s+/g, "");
  const items = selected.length >= MIN_MANUAL_OVERLAY_SIGS ? selected : [];
  const draftItems =
    items.length >= MIN_MANUAL_OVERLAY_SIGS
      ? items
      : buildManualSigItemsFromDrafts(draft.drafts, state?.sigInventory, userId);
  const list = draftItems.length >= MIN_MANUAL_OVERLAY_SIGS ? draftItems : items;
  flags.forEach((sold, idx) => {
    if (!sold) return;
    const item = list[idx];
    if (item) {
      next.add(item.id);
      next.add(canonicalSigIdFromWheelSliceId(item.id));
      const nk = normalizeNameKey(item.name);
      const price = Math.floor(Number(item.price || 0));
      for (const row of state?.sigInventory || []) {
        if (!row || row.id === ONE_SHOT_SIG_ID) continue;
        if (
          normalizeNameKey(row.name) === nk &&
          Math.floor(Number(row.price || 0)) === price
        ) {
          next.add(row.id);
          next.add(canonicalSigIdFromWheelSliceId(row.id));
        }
      }
    }
    const sourceSid = String(draft.drafts?.[idx]?.sourceSigId || "").trim();
    if (sourceSid) {
      next.add(sourceSid);
      next.add(canonicalSigIdFromWheelSliceId(sourceSid));
    }
  });
  if (draft.oneShotMarkSold) {
    next.add(ONE_SHOT_SIG_ID);
    next.add(canonicalSigIdFromWheelSliceId(ONE_SHOT_SIG_ID));
  }
  return next;
}

/** 재고에서 5개 랜덤 + 한방 합산 */
export function pickRandomManualSigBundle(
  base: AppState,
  userId: string,
  opts?: { memberFilterId?: string }
): { selected: SigItem[]; oneShot: { id: string; name: string; price: number } } | null {
  const pool = listActiveManualSigPool(base.sigInventory, {
    memberFilterId: opts?.memberFilterId,
    sigSalesExcludedIds: base.sigSalesExcludedIds,
  });
  const drafts = pickRandomManualSigDrafts(pool, 5);
  if (!drafts) return null;
  const selected = buildManualSigItemsFromDrafts(drafts, base.sigInventory, userId);
  const oneShot = buildOneShotFromSelected(selected);
  if (!oneShot || selected.length < 5) return null;
  return { selected, oneShot };
}

export function buildManualSigBroadcastState(
  base: AppState,
  selected: SigItem[],
  oneShot: { id: string; name: string; price: number },
  opts?: { persistDrafts?: ManualSigDraftPersist }
): AppState {
  const now = Date.now();
  const prevOverlaySettings =
    base.overlaySettings && typeof base.overlaySettings === "object"
      ? (base.overlaySettings as Record<string, unknown>)
      : {};
  return {
    ...base,
    ...(opts?.persistDrafts
      ? {
          overlaySettings: {
            ...prevOverlaySettings,
            [MANUAL_SIG_DRAFT_STATE_KEY]: opts.persistDrafts,
          },
        }
      : {}),
    rouletteState: {
      ...base.rouletteState,
      phase: "LANDED",
      isRolling: false,
      sessionId: MANUAL_OVERLAY_SESSION_ID,
      startedAt: now,
      selectedSigs: selected,
      results: selected,
      result: selected[selected.length - 1] || null,
      oneShotResult: oneShot,
      spinCount: selected.length,
      overlayReloadNonce: Number(base.rouletteState?.overlayReloadNonce || 0) + 1,
    },
    updatedAt: now,
  };
}
