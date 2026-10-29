import type { AppState } from "@/types";
import { listActiveManualSigPool } from "@/lib/manual-sig-active-pool";
import {
  buildManualPanelSaleRows,
  readManualSigDraftFromState,
  resolveManualOverlaySelectedSigs,
} from "@/lib/manual-sig-broadcast";
import { isManualSigBroadcastTerminalPhase } from "@/lib/manual-sig-broadcast-state";
import {
  normalizeManualBuyerMemberIds,
  readManualSigPickCountFromOverlaySettings,
} from "@/lib/manual-sig-workbench";
export type SigNeonMenuOverlayItem = {
  id: string;
  name: string;
  price: number;
  sold?: boolean;
  buyerName?: string;
};

/**
 * 네온 메뉴 보드 항목.
 * - 수동 리롤 LANDED/CONFIRMED 당첨이 있으면 **당첨 칸(초안 가격)** 을 보여 리롤이 OBS에 반영된다.
 * - 없으면 판매 중 시그 전체 풀(기존 /overlay/sig-menu 동작).
 */
export function resolveSigNeonMenuOverlayItems(
  state: AppState | null | undefined,
  userId: string,
  opts?: { memberFilterId?: string }
): SigNeonMenuOverlayItem[] {
  if (!state) return [];
  const uid = String(userId || "").trim();
  const memberFilterId = String(opts?.memberFilterId || "").trim();
  const terminal = isManualSigBroadcastTerminalPhase(state);
  const rolled = resolveManualOverlaySelectedSigs(state, uid);
  const draft = readManualSigDraftFromState(state);
  const os =
    state.overlaySettings && typeof state.overlaySettings === "object"
      ? (state.overlaySettings as Record<string, unknown>)
      : null;
  const pickCount = readManualSigPickCountFromOverlaySettings(os);
  const soldFlags = Array.isArray(draft?.sigSoldFlags) ? draft!.sigSoldFlags : [];
  const buyers = normalizeManualBuyerMemberIds(draft?.sigBuyerMemberIds, soldFlags, pickCount);
  const nameOf = (memberId: string | null | undefined) => {
    const id = String(memberId || "").trim();
    if (!id) return "";
    return String((state.members || []).find((m) => m.id === id)?.name || "").trim();
  };

  if (terminal && rolled.length >= 2) {
    const rows = buildManualPanelSaleRows(state, uid);
    if (rows.length >= 2) {
      return rows.map((row) => ({
        id: `roll_${row.draftIdx}_${row.name}`,
        name: row.name,
        price: row.price,
        sold: Boolean(soldFlags[row.draftIdx]),
        buyerName: nameOf(buyers[row.draftIdx]),
      }));
    }
  }

  const pool = listActiveManualSigPool(state.sigInventory, {
    ignoreStock: true,
    sigSalesExcludedIds: state.sigSalesExcludedIds,
    memberFilterId: memberFilterId || undefined,
    ownerUserId: uid,
  });
  return [...pool]
    .sort((a, b) => a.price - b.price || a.name.localeCompare(b.name, "ko"))
    .map((row) => ({
      id: row.id,
      name: row.name,
      price: row.price,
    }));
}
