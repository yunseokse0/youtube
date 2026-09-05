import type {
  RouletteState,
  SigItem,
  TimerState,
  MatchTimerEnabled,
  MissionItem,
  AppState,
  DonationTableColumnsOptions,
  HighSocietySettings,
} from "@/types";
import type { ObsTextOverlayRegistry } from "@/lib/obs-text-overlay";
import { normalizeSigInventory } from "@/lib/constants";
import { normalizeObsTextRegistry } from "@/lib/obs-text-overlay";
import { normalizeRestroomCount } from "@/lib/restroom-utils";
import { normalizeTerritoryLogs } from "@/lib/territory-utils";
import { normalizeContributionFormula } from "@/lib/contribution-formula";
import { normalizeAnonymousDonorDisplayName } from "@/lib/donation/anonymous-donor-name";
import { normalizeOverlayPresetDonationGoals } from "@/lib/goal-preset-math";
import { normalizeDonationTableColumnsOptions } from "@/lib/donation-table-options";
import {
  normalizeHighSocietySettings,
  normalizeHighSocietyDonationLinks,
} from "@/lib/high-society";

export function normalizeRouletteState(raw: unknown): RouletteState {
  const def: RouletteState = {
    phase: "IDLE",
    isRolling: false,
    result: null,
    spinCount: 0,
    startedAt: 0,
    overlayOpacity: 0.85,
    menuCount: 10,
    sigResultScalePct: 78,
    menuFillFromAllActive: true,
    oneShotResult: null,
  };
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return def;
  const o = raw as Record<string, unknown>;
  let results: SigItem[] | undefined;
  if (Array.isArray(o.results)) {
    const norm = normalizeSigInventory(o.results.filter((x) => x && typeof x === "object") as unknown[]);
    results = norm.length > 0 ? norm : undefined;
  }
  let selectedSigs: SigItem[] | undefined;
  if (Array.isArray(o.selectedSigs)) {
    const norm = normalizeSigInventory(o.selectedSigs.filter((x) => x && typeof x === "object") as unknown[]);
    selectedSigs = norm.length > 0 ? norm : undefined;
  }
  let spinPriceFilters: (number | null)[] | undefined;
  if (Array.isArray(o.spinPriceFilters)) {
    spinPriceFilters = o.spinPriceFilters.map((x) => {
      if (x === null) return null;
      const n = Number(x);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    });
  }
  let spinPriceRanges: ({ min: number | null; max: number | null } | null)[] | undefined;
  if (Array.isArray((o as Record<string, unknown>).spinPriceRanges)) {
    const raw = (o as Record<string, unknown>).spinPriceRanges as unknown[];
    spinPriceRanges = raw.map((x) => {
      if (x == null || typeof x !== "object") return null;
      const minNum = Number((x as Record<string, unknown>).min);
      const maxNum = Number((x as Record<string, unknown>).max);
      const min = Number.isFinite(minNum) && minNum > 0 ? Math.floor(minNum) : null;
      const max = Number.isFinite(maxNum) && maxNum > 0 ? Math.floor(maxNum) : null;
      if (min == null && max == null) return null;
      if (min != null && max != null && min > max) return { min: max, max: min };
      return { min, max };
    });
  }
  let result: SigItem | null = null;
  if (o.result && typeof o.result === "object") {
    const arr = normalizeSigInventory([o.result]);
    result = arr[0] || null;
  } else if (results && results.length > 0) {
    result = results[results.length - 1] ?? null;
  }
  const rawPhase = String(o.phase || "").toUpperCase();
  const phase = rawPhase === "SPINNING" || rawPhase === "LANDED" || rawPhase === "CONFIRM_PENDING" || rawPhase === "CONFIRMED"
    ? (rawPhase as RouletteState["phase"])
    : "IDLE";
  const overlayOpacityRaw = Number(o.overlayOpacity);
  const overlayOpacity = Number.isFinite(overlayOpacityRaw) ? Math.max(0.4, Math.min(1, overlayOpacityRaw)) : 0.85;
  const menuCountRaw = Number(o.menuCount);
  const menuCount = Number.isFinite(menuCountRaw) ? Math.max(5, Math.min(20, Math.floor(menuCountRaw))) : 10;
  const sigResultScalePctRaw = Number(o.sigResultScalePct);
  const sigResultScalePct = Number.isFinite(sigResultScalePctRaw)
    ? Math.max(50, Math.min(100, Math.floor(sigResultScalePctRaw)))
    : 78;
  const menuFillFromAllActive = typeof o.menuFillFromAllActive === "boolean" ? o.menuFillFromAllActive : true;
  const overlayReloadNonce = Number.isFinite(Number(o.overlayReloadNonce))
    ? Math.max(0, Math.floor(Number(o.overlayReloadNonce)))
    : 0;
  const oneShotRaw = o.oneShotResult;
  const oneShotResult =
    oneShotRaw && typeof oneShotRaw === "object"
      ? {
          id: String((oneShotRaw as Record<string, unknown>).id || "sig_one_shot"),
          name: String((oneShotRaw as Record<string, unknown>).name || "한방 시그"),
          price: Math.max(0, Math.floor(Number((oneShotRaw as Record<string, unknown>).price || 0))),
        }
      : null;
  const historyLogs = Array.isArray(o.historyLogs)
    ? o.historyLogs
        .filter((x) => x && typeof x === "object")
        .slice(0, 50)
        .map((x) => {
          const r = x as Record<string, unknown>;
          const selectedSigs = Array.isArray(r.selectedSigs)
            ? normalizeSigInventory((r.selectedSigs as unknown[]).filter((s) => s && typeof s === "object"))
            : [];
          const pr = String(r.phase || "");
          const phase: "LANDED" | "CONFIRMED" | "CANCELLED" =
            pr === "CANCELLED" ? "CANCELLED" : pr === "LANDED" ? "LANDED" : "CONFIRMED";
          return {
            id: String(r.id || ""),
            sessionId: String(r.sessionId || ""),
            phase,
            selectedSigs,
            selectedSigIds: selectedSigs.map((s) => s.id),
            oneShotPrice: Math.max(0, Math.floor(Number(r.oneShotPrice || 0))),
            totalPrice: Math.max(0, Math.floor(Number(r.totalPrice || 0))),
            timestamp: Math.max(0, Math.floor(Number(r.timestamp || 0))),
            adminId: typeof r.adminId === "string" ? r.adminId : undefined,
            reason: typeof r.reason === "string" ? r.reason : undefined,
          };
        })
    : undefined;
  return {
    phase,
    isRolling: Boolean(o.isRolling),
    result,
    spinCount: Number.isFinite(o.spinCount) ? Math.max(0, Math.floor(Number(o.spinCount))) : 0,
    startedAt: Number.isFinite(o.startedAt) ? Math.max(0, Math.floor(Number(o.startedAt))) : 0,
    results,
    selectedSigs,
    oneShotResult,
    overlayOpacity,
    menuCount,
    sigResultScalePct,
    menuFillFromAllActive,
    overlayReloadNonce,
    sessionId: typeof o.sessionId === "string" ? o.sessionId : undefined,
    sessionExcludedSigIds: Array.isArray(o.sessionExcludedSigIds)
      ? o.sessionExcludedSigIds.map((x) => String(x).trim()).filter(Boolean)
      : undefined,
    lastFinishedAt: Number.isFinite(Number(o.lastFinishedAt)) ? Math.max(0, Math.floor(Number(o.lastFinishedAt))) : undefined,
    historyLogs,
    spinPriceFilters,
    spinPriceRanges,
  };
}

export function buildRouletteIdlePreserveSettings(
  cur: RouletteState | undefined,
  opts?: { clearSessionExcluded?: boolean }
): RouletteState {
  const base = cur ?? normalizeRouletteState(null);
  const idle = normalizeRouletteState(null);
  return {
    ...idle,
    menuCount: base.menuCount ?? idle.menuCount,
    sigResultScalePct: base.sigResultScalePct ?? idle.sigResultScalePct,
    menuFillFromAllActive: base.menuFillFromAllActive ?? idle.menuFillFromAllActive,
    overlayOpacity: base.overlayOpacity ?? idle.overlayOpacity,
    overlayReloadNonce: base.overlayReloadNonce ?? 0,
    historyLogs: base.historyLogs,
    spinPriceFilters: base.spinPriceFilters,
    spinPriceRanges: base.spinPriceRanges,
    sessionExcludedSigIds: opts?.clearSessionExcluded ? [] : base.sessionExcludedSigIds,
  };
}

export function normalizeRouletteSettings(raw: unknown): RouletteState {
  return normalizeRouletteState(raw);
}

export function normalizeTimerState(input: unknown): TimerState {
  const t = input && typeof input === "object" ? (input as Partial<TimerState>) : {};
  return {
    remainingTime: Number.isFinite(t.remainingTime) ? Math.max(0, Math.floor(t.remainingTime as number)) : 0,
    isActive: Boolean(t.isActive),
    lastUpdated: Number.isFinite(t.lastUpdated) ? Math.max(0, Math.floor(t.lastUpdated as number)) : 0,
  };
}

export function normalizeMatchTimerEnabled(input: unknown): MatchTimerEnabled {
  const v = input && typeof input === "object" ? (input as Partial<MatchTimerEnabled>) : {};
  const general = typeof v.general === "boolean" ? v.general : true;
  return {
    general,
    match: typeof v.match === "boolean" ? v.match : general,
  };
}

export function normalizeMissionItems(items: unknown[] | undefined | null): MissionItem[] {
  if (!Array.isArray(items)) return [];
  return items.filter((x): x is MissionItem => {
    if (!x || typeof x !== "object") return false;
    const t = x as Record<string, unknown>;
    return typeof t.title === "string" && typeof t.price === "string";
  }).map((x) => ({
    id: String((x as MissionItem).id || ""),
    title: String((x as MissionItem).title || ""),
    price: String((x as MissionItem).price || ""),
    isHot: Boolean((x as MissionItem).isHot),
  }));
}

export function ensureMissionItems(items: unknown[] | undefined | null): MissionItem[] {
  return normalizeMissionItems(items);
}

export {
  normalizeObsTextRegistry,
  normalizeRestroomCount,
  normalizeTerritoryLogs,
  normalizeSigInventory,
  normalizeContributionFormula,
  normalizeAnonymousDonorDisplayName,
  normalizeOverlayPresetDonationGoals,
  normalizeDonationTableColumnsOptions,
  normalizeHighSocietySettings,
  normalizeHighSocietyDonationLinks,
};

export type { ObsTextOverlayRegistry };
