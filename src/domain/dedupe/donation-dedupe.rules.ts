import type { Donor } from "@/types";
import {
  SAME_TOONATION_EVENT_NEAR_DUP_MS,
  DONATION_IDENTICAL_MESSAGE_NEAR_DUP_MS,
  CROSS_SOURCE_NEAR_DUP_MS,
  BANK_RESEND_NEAR_DUP_MS,
} from "@/lib/donation/donation-dedupe-keys";
import {
  extractReliableToonationExtFromDonorId,
  isReliableToonationExternalId,
} from "@/lib/donation/toonation/parse-event";
import { resolveEffectiveDonorTarget } from "@/lib/state";

export type SourceKind = "bank" | "toonation" | "other";

export const DONATION_NEAR_DUP_WINDOW_MS = 3_000;

export function normalizeDonorNameKey(raw?: string): string {
  return String(raw || "").trim().toLowerCase().replace(/\s+/g, "");
}

export function donorTargetField(target?: string): "account" | "toon" {
  return target === "toon" ? "toon" : "account";
}

export function normalizeDonationEventId(id: string): string {
  return String(id || "").replace(/::review$/i, "");
}

export function isWeakToonationDonorId(id: string): boolean {
  const base = normalizeDonationEventId(String(id || "").trim()).replace(/^toonation:/i, "");
  if (!base) return false;
  /** ✅ 2026-09-06 Hotfix: toonation:din:<DB id> 형식 = DIN 허브 정식 발급 row ID.
   *  기존 default fallback return true (weak) 로 인해 DIN 허브 후원이 전부 weak ID로 오인되어,
   *  allowMergeByContent → shouldTreatAsDuplicateDonationContent (3초 윈도우 content dedup) 에 걸려
   *  6연속 후원이 1건으로 merge 되는 오탐 방지. DIN 허브 ID는 strong으로 간주. */
  if (/^din:/i.test(base)) return false;
  if (/^(fp-|test-|toon-|seq-|don-|stub-|mock-)/i.test(base)) return true;
  if (/^\d{10,13}-\d+(-\d+-[a-z0-9]+)?$/i.test(base)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(base)) return false;
  if (/^[0-9a-f]{32}$/i.test(base)) return false;
  return true;
}

export function donorAtEpochMs(donor: { at?: number | string }): number {
  const raw = donor.at;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const parsed = Date.parse(String(raw || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isDonorExcludedFromDonationTotals(donor: { donationExcluded?: boolean }): boolean {
  return donor.donationExcluded === true;
}

export function donationContentMatchKey(donor: {
  name?: string;
  donorName?: string;
  amount?: number;
  target?: string;
  message?: string;
}): string {
  const name = String(donor.donorName ?? donor.name ?? "").trim().toLowerCase();
  const amount = Math.max(0, Math.round(Number(donor.amount) || 0));
  const target = resolveEffectiveDonorTarget(donor);
  const msg = String(donor.message || "").trim().toLowerCase();
  return `${name}|${amount}|${target}|${msg}`;
}

export function donorInferSourceKind(
  d:
    | {
        id?: unknown;
        target?: unknown;
        provider?: unknown;
        externalId?: unknown;
        rawHash?: unknown;
      }
    | string
    | null
    | undefined
): SourceKind {
  if (!d) return "other";
  let id = "";
  let target = "";
  let provider = "";
  let ext = "";
  if (typeof d === "string") {
    id = d.trim().toLowerCase();
  } else {
    id = String(d.id ?? "").trim().toLowerCase();
    target = String(d.target ?? "").trim().toLowerCase();
    provider = String(d.provider ?? "").trim().toLowerCase();
    ext = String(d.externalId ?? d.rawHash ?? "").trim();
  }
  if (["toonation", "toona", "tuna", "tunat"].includes(provider)) return "toonation";
  if (["bank", "sms", "account", "din_bank"].includes(provider)) return "bank";
  if (ext && /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(ext))
    return "toonation";
  if (id.startsWith("toonation:") || id.startsWith("toona:") || id.startsWith("tuna:"))
    return "toonation";
  if (id.startsWith("bank:") || id.startsWith("account:")) return "bank";
  if (["toon", "toonation", "tunat", "tuna", "투네", "튜나"].includes(target)) return "toonation";
  if (["account", "bank", "계좌", "은행"].includes(target)) return "bank";
  return "other";
}

export function isOwnerRemapSplitDuplicate(
  existing: {
    name?: string;
    amount?: number;
    target?: string;
    message?: string;
    at?: number | string;
    memberId?: string;
  },
  incoming: {
    donorName?: string;
    amount?: number;
    target?: string;
    message?: string;
    at?: string | number;
    memberId?: string;
  }
): boolean {
  const amountA = Math.max(0, Math.round(Number(existing.amount) || 0));
  const amountB = Math.max(0, Math.round(Number(incoming.amount) || 0));
  if (amountA <= 0 || amountA !== amountB) return false;
  const atA = donorAtEpochMs(existing);
  const atB = donorAtEpochMs(incoming);
  if (Math.abs(atA - atB) > DONATION_NEAR_DUP_WINDOW_MS) return false;
  const targetA = donorTargetField(existing.target);
  const targetB = donorTargetField(incoming.target);
  if (targetA === targetB) return false;
  const memA = String(existing.memberId || "").trim();
  const memB = String(incoming.memberId || "").trim();
  if (memA && memB && memA !== memB) return false;
  const msgA = String(existing.message || "").trim().toLowerCase();
  const msgB = String(incoming.message || "").trim().toLowerCase();
  if (msgA && msgB && msgA === msgB) return true;
  const nameA = String(existing.name || "").trim().toLowerCase();
  const nameB = String(incoming.donorName || "").trim().toLowerCase();
  if (msgA && nameB && msgA.includes(nameB)) return true;
  if (msgB && nameA && msgB.includes(nameA)) return true;
  if (!msgA && !msgB) {
    const anon = (n: string) => {
      const t = String(n || "").trim().toLowerCase();
      return t === "익명" || t === "anonymous" || t === "anon" || t === "unknown";
    };
    if (anon(nameA) || anon(nameB)) return true;
  }
  return false;
}

function donationContentProbe(donor: {
  name?: string;
  donorName?: string;
  amount?: number;
  target?: string;
  message?: string;
}) {
  return {
    name: donor.name,
    donorName: donor.donorName ?? donor.name,
    amount: donor.amount,
    target: donor.target,
    message: donor.message,
  };
}

export function isNearContentDuplicate(
  existing: {
    name?: string;
    amount?: number;
    target?: string;
    message?: string;
    at?: number | string;
  },
  incoming: {
    donorName?: string;
    name?: string;
    amount?: number;
    target?: string;
    message?: string;
    at?: string | number;
    id?: string;
    externalId?: string;
  },
  windowMs = DONATION_NEAR_DUP_WINDOW_MS
): boolean {
  if (
    donationContentMatchKey(donationContentProbe(existing)) !==
    donationContentMatchKey(donationContentProbe(incoming))
  ) {
    return false;
  }
  const atA = donorAtEpochMs(existing);
  const atB = donorAtEpochMs(incoming);
  if (!atA || !atB) return false;
  return Math.abs(atA - atB) <= windowMs;
}

function reliableExtFromIncoming(incoming: { id?: string; externalId?: string }): string | null {
  const fromId = extractReliableToonationExtFromDonorId(String(incoming.id || ""));
  if (fromId) return fromId;
  const ext = String(incoming.externalId || "").trim();
  if (ext) {
    const fromExt = extractReliableToonationExtFromDonorId(`toonation:${ext}`);
    if (fromExt) return fromExt;
    if (isReliableToonationExternalId(ext)) return ext.toLowerCase();
  }
  return null;
}

function isSameToonationEventNearDuplicate(
  existing: {
    id?: string;
    amount?: number;
    at?: number | string;
    externalId?: string;
    rawHash?: string | number;
    groupSplit?: boolean;
    groupSplitSource?: boolean;
    memberId?: string;
    donationExcluded?: boolean;
  },
  incoming: {
    id?: string;
    externalId?: string;
    amount?: number;
    at?: string | number;
    rawHash?: string | number;
    groupSplit?: boolean;
    groupSplitSource?: boolean;
    memberId?: string;
    donationExcluded?: boolean;
  }
): boolean {
  const existingRaw = String(existing.id || "").trim();
  const incomingRaw = String(incoming.id || "").trim();
  {
    const existingReliableExt =
      extractReliableToonationExtFromDonorId(existingRaw) ||
      (() => {
        const e = String(existing.externalId || existing.rawHash || "").trim();
        return e && isReliableToonationExternalId(e) ? e.toLowerCase() : null;
      })();
    const incomingReliableExt =
      extractReliableToonationExtFromDonorId(incomingRaw) || reliableExtFromIncoming(incoming);
    if (existingReliableExt && incomingReliableExt && existingReliableExt === incomingReliableExt) {
      const amountA = Math.max(0, Math.round(Number(existing.amount) || 0));
      const amountB = Math.max(0, Math.round(Number(incoming.amount) || 0));
      if (amountA > 0 && amountA === amountB) {
        const atA = donorAtEpochMs(existing);
        const atB = donorAtEpochMs(incoming);
        if (!atA || !atB) return true;
        return Math.abs(atA - atB) <= SAME_TOONATION_EVENT_NEAR_DUP_MS;
      }
    }
  }
  if (
    existingRaw &&
    incomingRaw &&
    (isWeakToonationDonorId(existingRaw) || isWeakToonationDonorId(incomingRaw))
  ) {
    return existingRaw === incomingRaw;
  }
  const extA = extractReliableToonationExtFromDonorId(String(existing.id || ""));
  const extB = reliableExtFromIncoming(incoming);
  if (!extA || !extB || extA !== extB) return false;
  const amountA = Math.max(0, Math.round(Number(existing.amount) || 0));
  const amountB = Math.max(0, Math.round(Number(incoming.amount) || 0));
  if (amountA <= 0 || amountA !== amountB) return false;
  const atA = donorAtEpochMs(existing);
  const atB = donorAtEpochMs(incoming);
  if (!atA || !atB) return false;
  return Math.abs(atA - atB) <= SAME_TOONATION_EVENT_NEAR_DUP_MS;
}

function identicalMessageNearDupWindowMs(
  existing: { message?: string },
  incoming: { message?: string }
): number | null {
  const msgA = String(existing.message || "").trim().toLowerCase();
  const msgB = String(incoming.message ?? "").trim().toLowerCase();
  if (!msgA || !msgB || msgA !== msgB) return null;
  return DONATION_IDENTICAL_MESSAGE_NEAR_DUP_MS;
}

function resolveNearDupWindowMs(
  existing: { message?: string; id?: string; amount?: number; at?: number | string },
  incoming: {
    message?: string;
    id?: string;
    externalId?: string;
    amount?: number;
    at?: string | number;
  }
): number {
  const msgWindow = identicalMessageNearDupWindowMs(existing, incoming);
  if (msgWindow != null) return msgWindow;
  const extA = extractReliableToonationExtFromDonorId(String(existing.id || ""));
  const extB = reliableExtFromIncoming(incoming);
  if (extA && extB && extA === extB) return SAME_TOONATION_EVENT_NEAR_DUP_MS;
  return DONATION_NEAR_DUP_WINDOW_MS;
}

export function isCrossDonationSourcePair(
  a?:
    | {
        id?: unknown;
        target?: unknown;
        provider?: unknown;
        externalId?: unknown;
        rawHash?: unknown;
      }
    | string
    | null,
  b?:
    | {
        id?: unknown;
        target?: unknown;
        provider?: unknown;
        externalId?: unknown;
        rawHash?: unknown;
      }
    | string
    | null
): boolean {
  const kindA = donorInferSourceKind(a as never);
  const kindB = donorInferSourceKind(b as never);
  if (kindA === "bank" && kindB === "toonation") return true;
  if (kindA === "toonation" && kindB === "bank") return true;
  return false;
}

export function shouldTreatAsCrossSourceDuplicate(
  existing: {
    id?: string;
    name?: string;
    amount?: number;
    at?: number | string;
    externalId?: string;
    rawHash?: string | number;
    donorName?: string;
    target?: string;
    provider?: string;
  },
  incoming: {
    id?: string;
    donorName?: string;
    name?: string;
    amount?: number;
    at?: string | number;
    externalId?: string;
    rawHash?: string | number;
    target?: string;
    provider?: string;
  }
): boolean {
  const cross = isCrossDonationSourcePair(existing, incoming);
  const bothBank =
    donorInferSourceKind(existing) === "bank" && donorInferSourceKind(incoming) === "bank";
  if (!cross && !bothBank) return false;

  const extA = String(existing.externalId || existing.rawHash || "").trim();
  const extB = String(incoming.externalId || incoming.rawHash || "").trim();
  if (extA && extB && isReliableToonationExternalId(extA) && isReliableToonationExternalId(extB)) {
    if (extA.toLowerCase() !== extB.toLowerCase()) return false;
  }
  const idExtA = extractReliableToonationExtFromDonorId(String(existing.id || ""));
  const idExtB = extractReliableToonationExtFromDonorId(String(incoming.id || ""));
  if (idExtA && idExtB && idExtA !== idExtB) return false;

  const amountA = Math.max(0, Math.round(Number(existing.amount) || 0));
  const amountB = Math.max(0, Math.round(Number(incoming.amount) || 0));
  if (amountA <= 0 || amountA !== amountB) return false;

  const nameA = normalizeDonorNameKey(existing.name ?? existing.donorName);
  const nameB = normalizeDonorNameKey(incoming.donorName ?? incoming.name);
  if (!nameA || !nameB || nameA !== nameB) return false;

  const atA = donorAtEpochMs(existing);
  const atB = donorAtEpochMs(incoming);
  if (!atA || !atB) return false;
  const windowMs = cross ? CROSS_SOURCE_NEAR_DUP_MS : BANK_RESEND_NEAR_DUP_MS;
  return Math.abs(atA - atB) <= windowMs;
}

export function shouldTreatAsDuplicateDonationContent(
  existing: {
    id?: string;
    name?: string;
    amount?: number;
    target?: string;
    message?: string;
    at?: number | string;
    externalId?: string;
    rawHash?: string | number;
    groupSplit?: boolean;
    groupSplitSource?: boolean;
    memberId?: string;
    donationExcluded?: boolean;
  },
  incoming: {
    id?: string;
    externalId?: string;
    donorName?: string;
    name?: string;
    amount?: number;
    target?: string;
    message?: string;
    at?: string | number;
    rawHash?: string | number;
    groupSplit?: boolean;
    groupSplitSource?: boolean;
    memberId?: string;
    donationExcluded?: boolean;
  }
): boolean {
  const existingSplit =
    Boolean(existing.groupSplit) ||
    String(existing.id || "").includes(":split:") ||
    Boolean(existing.groupSplitSource);
  const incomingSplit =
    Boolean(incoming.groupSplit) ||
    String(incoming.id || "").includes(":split:") ||
    Boolean(incoming.groupSplitSource);
  if (existingSplit || incomingSplit) {
    const existingMemId = String(existing.memberId || "").trim();
    const incomingMemId = String(incoming.memberId || "").trim();
    if (existingSplit !== incomingSplit) return false;
    if (existingMemId && incomingMemId && existingMemId !== incomingMemId) return false;
    if (
      Boolean(existing.groupSplit) !== Boolean(incoming.groupSplit) ||
      Boolean(existing.groupSplitSource) !== Boolean(incoming.groupSplitSource)
    ) {
      return false;
    }
  }

  const existingRawId = String(existing.id || "").trim();
  const incomingRawId = String(incoming.id || "").trim();

  {
    const existingReliableExt =
      extractReliableToonationExtFromDonorId(existingRawId) ||
      (() => {
        const e = String(existing.externalId || existing.rawHash || "").trim();
        return e && isReliableToonationExternalId(e) ? e.toLowerCase() : null;
      })();
    const incomingReliableExt =
      extractReliableToonationExtFromDonorId(incomingRawId) || reliableExtFromIncoming(incoming);
    if (existingReliableExt && incomingReliableExt && existingReliableExt === incomingReliableExt) {
      const amountA = Math.max(0, Math.round(Number(existing.amount) || 0));
      const amountB = Math.max(0, Math.round(Number(incoming.amount) || 0));
      if (amountA > 0 && amountA === amountB) return true;
    }
  }

  if (shouldTreatAsCrossSourceDuplicate(existing, incoming)) return true;

  if (isOwnerRemapSplitDuplicate(existing, incoming)) return true;

  {
    const burstAmountA = Math.max(0, Math.round(Number(existing.amount) || 0));
    const burstAmountB = Math.max(0, Math.round(Number(incoming.amount) || 0));
    if (burstAmountA > 0 && burstAmountA === burstAmountB) {
      const burstAt1 = donorAtEpochMs(existing);
      const burstAt2 = donorAtEpochMs(incoming);
      if (burstAt1 && burstAt2 && Math.abs(burstAt1 - burstAt2) < 1_000) {
        const burstNameA = String(existing.name || "").trim().toLowerCase();
        const burstNameB = String(incoming.donorName || incoming.name || "").trim().toLowerCase();
        const extAA = extractReliableToonationExtFromDonorId(existingRawId);
        const extBB = extractReliableToonationExtFromDonorId(incomingRawId);
        const bothReliableAndDifferent = extAA && extBB && extAA !== extBB;
        if (
          !bothReliableAndDifferent &&
          burstNameA &&
          burstNameB &&
          burstNameA === burstNameB
        ) {
          return true;
        }
      }
    }
  }

  if (isSameToonationEventNearDuplicate(existing, incoming)) return true;

  if (
    existingRawId &&
    incomingRawId &&
    (isWeakToonationDonorId(existingRawId) || isWeakToonationDonorId(incomingRawId))
  ) {
    const msgWindow = identicalMessageNearDupWindowMs(existing, incoming);
    const crossOrBothBank =
      isCrossDonationSourcePair(existing, incoming) ||
      (donorInferSourceKind(existing) === "bank" && donorInferSourceKind(incoming) === "bank");
    const atA = donorAtEpochMs(existing);
    const atB = donorAtEpochMs(incoming);
    const atGap = atA && atB ? Math.abs(atA - atB) : Infinity;
    const withinAnyNearWindow =
      msgWindow != null || crossOrBothBank || atGap <= DONATION_NEAR_DUP_WINDOW_MS;
    if (!withinAnyNearWindow) {
      return existingRawId === incomingRawId;
    }
  }

  const windowMs = resolveNearDupWindowMs(existing, incoming);
  if (!isNearContentDuplicate(existing, incoming, windowMs)) return false;
  const extA = extractReliableToonationExtFromDonorId(String(existing.id || ""));
  const extB = reliableExtFromIncoming(incoming);

  if (extA && extB && extA !== extB) {
    const extractPrefix = (raw: string): string => {
      const m = raw.match(
        /^(.*?)(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})/i
      );
      return m ? m[1].toLowerCase() : raw.toLowerCase();
    };
    const pA = extractPrefix(existingRawId);
    const pB = extractPrefix(incomingRawId);
    if (pA !== pB) {
      const amtA = Math.max(0, Math.round(Number(existing.amount) || 0));
      const amtB = Math.max(0, Math.round(Number(incoming.amount) || 0));
      if (amtA > 0 && amtA === amtB) {
        const at1 = donorAtEpochMs(existing);
        const at2 = donorAtEpochMs(incoming);
        if (at1 && at2 && Math.abs(at1 - at2) <= 3_000) {
          const tA = String(existing.target || "").trim().toLowerCase();
          const tB = String(incoming.target || "").trim().toLowerCase();
          if (tA && tB && tA === tB) {
            const nA = String(existing.name || "").trim().toLowerCase();
            const nB = String(incoming.donorName || incoming.name || "").trim().toLowerCase();
            if (nA && nB && nA === nB) {
              const m1 = String(existing.message || "").trim();
              const m2 = String(incoming.message || "").trim();
              if (m1 === m2) return true;
            }
          }
        }
      }
    }
    return false;
  }

  if (!extA && !extB) {
    const isFpA = /\bfp-/.test(existingRawId);
    const isFpB = /\bfp-/.test(incomingRawId);
    if (isFpA && isFpB) {
      return true;
    }
    return existingRawId === incomingRawId;
  }
  return true;
}

export function isSameInstantContentDuplicate(
  existing: {
    name?: string;
    amount?: number;
    target?: string;
    message?: string;
    at?: number | string;
  },
  incoming: {
    donorName?: string;
    name?: string;
    amount?: number;
    target?: string;
    message?: string;
    at?: string | number;
    id?: string;
    externalId?: string;
  }
): boolean {
  return shouldTreatAsDuplicateDonationContent(existing, incoming);
}
