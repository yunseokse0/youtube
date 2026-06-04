import type { AppState, SigItem } from "@/types";
import { resolveSigOverlayCardImageUrl } from "@/lib/constants";
import { buildOneShotFromSelected } from "@/lib/sig-one-shot-price";
import { pickRandomManualSigDrafts } from "@/lib/manual-sig-random";
import { listActiveManualSigPool } from "@/lib/manual-sig-active-pool";
import { MANUAL_OVERLAY_SESSION_ID } from "@/lib/sig-sales-manual-round";
import {
  MANUAL_SIG_DRAFT_STATE_KEY,
  normalizeManualSigDraftPersist,
  parseManualSigDraftRows,
  type ManualSigDraftPersist,
} from "@/lib/manual-sig-workbench";
import { hydrateSigItemFromInventory, ONE_SHOT_SIG_ID } from "@/lib/sig-roulette";

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
    return hydrateSigItemFromInventory(base, inventory, userId);
  });
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
