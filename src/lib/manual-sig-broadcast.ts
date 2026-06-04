import type { AppState, SigItem } from "@/types";
import { buildOneShotFromSelected } from "@/lib/sig-one-shot-price";
import { pickRandomManualSigDrafts } from "@/lib/manual-sig-random";
import { listActiveManualSigPool } from "@/lib/manual-sig-active-pool";
import { MANUAL_OVERLAY_SESSION_ID } from "@/lib/sig-sales-manual-round";
import { parseManualSigDraftRows } from "@/lib/manual-sig-workbench";
import { hydrateSigItemFromInventory } from "@/lib/sig-roulette";

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
  oneShot: { id: string; name: string; price: number }
): AppState {
  const now = Date.now();
  return {
    ...base,
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
