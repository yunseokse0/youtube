import { applyDonationDummySeed } from "@/lib/dev/seed-donation-dummy";
import { computeSettlement } from "@/lib/settlement-utils";
import { buildDefaultMembersCount, ensureMembers, normalizeDonorsArray } from "@/lib/state";
import type { AppState, SettlementRecord } from "@/types";

export type SeedSettlementTestOptions = {
  title?: string;
  accountRatio?: number;
  toonRatio?: number;
  feeRate?: number;
  taxInvoiceIssued?: boolean;
  /** false면 후원만 넣고 정산 레코드는 만들지 않음 */
  createSettlement?: boolean;
};

export function ensureSettlementTestMembers(state: AppState): AppState {
  const members = ensureMembers(state.members);
  if (members.length >= 2) return { ...state, members };
  return { ...state, members: buildDefaultMembersCount(3) };
}

export function buildSettlementTestRecord(
  state: AppState,
  opts?: SeedSettlementTestOptions
): SettlementRecord {
  const accountRatio = opts?.accountRatio ?? 0.7;
  const toonRatio = opts?.toonRatio ?? 0.6;
  const feeRate = opts?.feeRate ?? 0.033;
  const donors = normalizeDonorsArray(state.donors);
  const body = computeSettlement(
    state.members,
    accountRatio,
    toonRatio,
    feeRate,
    undefined,
    state.memberPositions || null
  );
  return {
    id: `st_dev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: (opts?.title || "개발 테스트 정산").trim(),
    createdAt: Date.now(),
    ...body,
    donors,
    memberPositionsAtSettlement:
      state.memberPositions && typeof state.memberPositions === "object"
        ? { ...state.memberPositions }
        : {},
    ...(opts?.taxInvoiceIssued ? { taxInvoiceIssued: true } : {}),
  };
}

export function applySettlementTestSeed(
  state: AppState,
  opts?: SeedSettlementTestOptions
): { state: AppState; donorsAdded: number; settlement: SettlementRecord | null } {
  const base = ensureSettlementTestMembers(state);
  const { state: seeded, added } = applyDonationDummySeed(base, { mode: "replace" });
  const settlement =
    opts?.createSettlement === false ? null : buildSettlementTestRecord(seeded, opts);
  return { state: seeded, donorsAdded: added.length, settlement };
}
