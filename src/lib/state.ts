import { DEFAULT_MEAL_GAUGE_EFFECTS, normalizeMealGaugeEffects } from "@/lib/meal-gauge-effects";
import { normalizeDonationTableColumnsOptions } from "@/lib/donation-table-options";
import { notifyBroadcastStateLocalUpdated } from "@/lib/broadcast-state-local-sync";
import {
  clampBrowserPersistOptionsForServerAuthority,
  isServerAuthoritativeBroadcastState,
  readSessionBroadcastState,
  writeSessionBroadcastState,
} from "@/lib/server-authoritative-broadcast-state";
import { isOperatingSettlementMember } from "@/lib/settlement-utils";
import { normalizeAnonymousDonorDisplayName } from "@/lib/donation/anonymous-donor-name";
import type {
  AppState,
  Donor,
  DonorTarget,
  ContributionLog,
  RestroomLog,
  MatchTimerEnabled,
  DonorRankingsTheme,
  DonorRankingsPreset,
  MealBattleState,
  MealMatchSettings,
  MealMatchState,
  Member,
  MissionItem,
  OverlayConfig,
  SigItem,
  SigMatchPool,
  SigMatchSettings,
  RouletteState,
  SigMatchState,
  TimerDisplayStyle,
  TimerState,
  SigRollingItem,
  SigRollingMetaEntry,
  SigRollingSettings,
  DonorsAmountFormat,
} from "@/types";
import {
  DEFAULT_CONTRIBUTION_FORMULA,
  normalizeContributionFormula,
} from "@/lib/contribution-formula";
import { isHiddenTimerDisplayStyle } from "@/lib/overlay-params";
import { isDefaultTimerDesign, normalizeTimerDesign } from "@/lib/timer-design";
import { normalizeVsDesign } from "@/lib/vs-design";
import {
  isDonationAmountEligibleForHighSocietyTerritory,
  normalizeHighSocietySettings,
  normalizeHighSocietyDonationLinks,
  resolveHighSocietySeatMembers,
  shouldBlockHighSocietyRegression,
  shouldSyncHighSocietyMemberWidthSnapshot,
  syncHighSocietyMemberWidthSnapshotInState,
} from "@/lib/high-society";
import { ONE_SHOT_SIG_ID, sigMatchesMemberFilter } from "@/lib/sig-roulette";
import { isBundledSigPlaceholderItem } from "@/lib/sig-placeholder";
import { normalizeRestroomCount } from "@/lib/restroom-utils";
import { normalizeTerritoryLogs } from "@/lib/territory-utils";
import { mergeGeneralTimerPreferEffective, snapshotTimerForPersist } from "@/lib/timer-utils";
import { sanitizeOverlayEmbedMediaUrl } from "@/lib/gif-url";
import {
  BROADCAST_SIG_PRESET_NAMES,
  DEFAULT_SIG_INVENTORY,
  normalizeSigImageUrlStored,
  normalizeSigInventory,
} from "./constants";
import { normalizeOverlayPresetDonationGoals } from "@/lib/goal-preset-math";
import {
  isDonorRankingsPickPartial,
  isOverlayPickPartial,
  revisionForStatePick,
  STATE_PICK_OBS_TEXT,
  STATE_PICK_SIG_SALES,
  type StateApiPick,
} from "@/lib/state-api-pick";
import { MANUAL_SIG_BROADCAST_STATE_KEY } from "@/lib/manual-sig-broadcast-state";
import { mergeDonorRowFields, syncMemberTotalsFromDonors, repairMemberTotalsForDonorRoster } from "@/lib/donation/apply-donation-state";
import { guardMemberTotalsAgainstAccidentalZeroWipe, wouldAccidentallyZeroRemainingMembers } from "@/lib/donation/zero-wipe-guard";
import { mergeMemberRosterPreservingAmounts } from "@/lib/member-roster-merge";
import { isGroupSplitDonorListMutation } from "@/lib/donation/group-split-donation";
import { MANUAL_SIG_DRAFT_STATE_KEY } from "@/lib/manual-sig-workbench";
import { OBS_TEXT_OVERLAY_STATE_KEY, normalizeObsTextRegistry, type ObsTextOverlayRegistry } from "@/lib/obs-text-overlay";
import { slimSigInventoryForWire } from "@/lib/state-wire-slim";
import { sanitizeAppStateWheelDemo } from "@/lib/sig-wheel-demo-pool";
import { normalizeTimerFontFamily } from "@/lib/timer-font-style";
export type {
  AppState,
  ContributionLog,
  RestroomLog,
  Donor,
  DonorTarget,
  LegacyOverlaySettings,
  MatchTimerEnabled,
  DonorRankingsTheme,
  DonorRankingsPreset,
  MealBattleState,
  MealMatchSettings,
  MealMatchState,
  Member,
  MissionItem,
  OverlayConfig,
  RouletteState,
  SigItem,
  SigMatchPool,
  SigMatchSettings,
  SigMatchState,
  TimerDisplayStyle,
  TimerState,
  SigRollingItem,
  SigRollingMetaEntry,
  SigRollingSettings,
} from "@/types";

/** 시그 롤링 오버레이 설정 정규화 */
export function normalizeSigRolling(input: unknown): SigRollingSettings {
  const decodeText = (raw: unknown): string => {
    let out = String(raw ?? "").trim();
    for (let i = 0; i < 4; i++) {
      if (!/%[0-9a-f]{2}/i.test(out)) break;
      try {
        const next = decodeURIComponent(out);
        if (next === out) break;
        out = next;
      } catch {
        break;
      }
    }
    return out;
  };
  const v = input && typeof input === "object" ? (input as Partial<SigRollingSettings>) : {};
  const rawItems: unknown[] = Array.isArray(v.items) ? (v.items as unknown[]) : [];
  const items = rawItems
    .filter((x): x is Record<string, unknown> => Boolean(x && typeof x === "object"))
    .map((x) => ({
      id: String(x.id || `sr_${Math.random().toString(36).slice(2, 10)}`),
      /** 레거시 `/images/sig/` 등 오타 보정 — 미리보기·OBS 동일 URL 사용 */
      url: normalizeSigImageUrlStored(x.url).trim(),
      label: decodeText(x.label),
    }))
    .filter((x) => x.url);
  const fadeMs = Number.isFinite(v.fadeMs) ? Math.max(180, Math.min(5000, Math.floor(Number(v.fadeMs)))) : 1000;
  const staticHoldMs = Number.isFinite(v.staticHoldMs)
    ? Math.max(1000, Math.min(120_000, Math.floor(Number(v.staticHoldMs))))
    : 5000;
  return { items, fadeMs, staticHoldMs };
}

function normalizeSigRollingMeta(input: unknown): Record<string, SigRollingMetaEntry> {
  const decodeText = (raw: unknown): string => {
    let out = String(raw ?? "").trim();
    for (let i = 0; i < 4; i++) {
      if (!/%[0-9a-f]{2}/i.test(out)) break;
      try {
        const next = decodeURIComponent(out);
        if (next === out) break;
        out = next;
      } catch {
        break;
      }
    }
    return out;
  };
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, SigRollingMetaEntry> = {};
  for (const [rawId, rawEntry] of Object.entries(input as Record<string, unknown>)) {
    const id = String(rawId || "").trim();
    if (!id || !rawEntry || typeof rawEntry !== "object") continue;
    const e = rawEntry as Record<string, unknown>;
    const label = decodeText(e.label);
    const orderNum = Number(e.order);
    const order = Number.isFinite(orderNum) ? Math.max(0, Math.floor(orderNum)) : undefined;
    if (!label && order === undefined) continue;
    out[id] = {};
    if (label) out[id]!.label = label;
    if (order !== undefined) out[id]!.order = order;
  }
  return out;
}

/**
 * 시그 판매 관리(회전판 후보)와 동일: 판매 활성·판매 제외·멤버 필터.
 * `memberFilterId`가 비어 있으면 멤버 구분 없이 전체 활성 시그.
 * 멤버가 지정되면 해당 멤버 전용 + 공통(`memberId` 빈 값) 시그.
 */
export function filterSigInventoryForSalesDisplay(
  state: Pick<AppState, "sigInventory" | "sigSalesExcludedIds"> | null | undefined,
  memberFilterId?: string | null
): SigItem[] {
  if (!state) return [];
  const excluded = new Set((state.sigSalesExcludedIds || []).map((x) => String(x)));
  return (state.sigInventory || []).filter(
    (x) =>
      x.id !== ONE_SHOT_SIG_ID &&
      Boolean(x.isActive) &&
      !excluded.has(x.id) &&
      sigMatchesMemberFilter(x, memberFilterId)
  );
}

/**
 * `/overlay/sig-rolling`·관리자 「시그 롤링」 목록.
 * 판매 활성(`isActive`)·판매 제외·멤버 필터에 더해 **`isRolling`이 켜진 시그만** 포함한다.
 * 인벤토리에 해당 행이 하나라도 있으면 구버전 `sigRolling.items`는 사용하지 않는다.
 */
export function getUnifiedSigRollingItems(
  state: Pick<AppState, "sigInventory" | "sigRolling" | "sigRollingMeta" | "sigSalesExcludedIds"> | null | undefined,
  memberFilterId?: string | null
): SigRollingItem[] {
  if (!state) return [];
  const meta = normalizeSigRollingMeta(state.sigRollingMeta);
  const invRows = filterSigInventoryForSalesDisplay(state, memberFilterId)
    .filter((x) => Boolean(x.isRolling))
    /** 기본 더미(NO IMAGE) 시그는 롤링에 올리지 않음 — 세로 더미 카드 노출 방지 */
    .filter((x) => !isBundledSigPlaceholderItem(x))
    .map((x, idx) => {
      const m = meta[x.id] || {};
      return {
        id: x.id,
        url: normalizeSigImageUrlStored(x.imageUrl).trim(),
        label: (m.label && String(m.label).trim()) || String(x.name || "").trim(),
        order: m.order ?? idx,
        price: Math.max(0, Math.floor(Number(x.price) || 0)),
      };
    })
    .filter((x) => x.url && !String(x.url).toLowerCase().includes("dummy-sig.svg"));
  const invById = new Map((state.sigInventory || []).map((x) => [x.id, x]));
  const legacy = normalizeSigRolling(state.sigRolling).items.filter((x) => {
    if (x.id === ONE_SHOT_SIG_ID) return false;
    if (String(x.url || "").toLowerCase().includes("dummy-sig.svg")) return false;
    if (isBundledSigPlaceholderItem({ id: x.id, imageUrl: x.url })) return false;
    const inv = invById.get(x.id);
    if (inv) return Boolean(inv.isRolling) && !isBundledSigPlaceholderItem(inv);
    return true;
  });
  if (invRows.length === 0) {
    return legacy.map((x) => {
      const inv = invById.get(x.id);
      return {
        ...x,
        price: Math.max(0, Math.floor(Number(inv?.price ?? x.price) || 0)),
      };
    });
  }
  return invRows
    .sort((a, b) => a.order - b.order)
    .map(({ id, url, label, price }) => ({ id, url, label, price }));
}

/** 시그 풀: 멤버는 최대 한 풀에만, 풀은 1인 이상(1인 팀·1:2·삼자 구분용) */
export function normalizeSigMatchPools(raw: unknown, validMemberIds: Set<string>): SigMatchPool[] {
  if (!Array.isArray(raw)) return [];
  const assigned = new Set<string>();
  const out: SigMatchPool[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const idRaw = (item as Record<string, unknown>).id;
    const id =
      typeof idRaw === "string" && idRaw.trim()
        ? idRaw.trim()
        : `pool_${out.length}_${Math.random().toString(36).slice(2, 6)}`;
    const idsRaw = (item as Record<string, unknown>).memberIds;
    const ids = Array.isArray(idsRaw)
      ? idsRaw.map((x) => String(x)).filter((mid) => mid && validMemberIds.has(mid) && !assigned.has(mid))
      : [];
    if (ids.length < 1) continue;
    for (const mid of ids) assigned.add(mid);
    out.push({ id, memberIds: ids });
  }
  return out;
}

/** 시그 대전 랭킹 참가자 목록(유효 id만, 순서 유지) */
export function normalizeSigMatchParticipantIds(raw: unknown, validMemberIds: Set<string>): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of raw) {
    const id = String(x);
    if (!id || !validMemberIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** 시그 멤버별 후원 연동 맵 정규화 */
export function normalizeSigMatchDonationLinks(
  raw: unknown,
  validMemberIds: Set<string>
): Record<string, { active: boolean; startedAt?: number }> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, { active: boolean; startedAt?: number }> = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!validMemberIds.has(id)) continue;
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const active = Boolean(o.active);
    const startedRaw = Number(o.startedAt);
    const startedAt = Number.isFinite(startedRaw) ? Math.max(0, Math.floor(startedRaw)) : undefined;
    out[id] = active
      ? { active: true, ...(startedAt !== undefined ? { startedAt } : {}) }
      : { active: false, ...(startedAt !== undefined ? { startedAt } : {}) };
  }
  return out;
}

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

/** 회전판 초기화·IDLE 복귀 — 메뉴·히스토리 등 설정만 유지, 당첨·세션·연출 필드는 비움 */
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

/** 기본 후원순위 오버레이 표시 상한 — 그 이상은 `/overlay/donor-rankings/full` */
export const DONOR_RANKINGS_COMPACT_TOP_MAX = 10;
/** 후원순위 글자 외곽선 두께 상한(px) — 참고샷의 두꺼운 검정 스트로크 */
export const DONOR_RANKINGS_OUTLINE_MAX_PX = 6;
/** 구버전 컴팩트 테마 기본 외곽선 — 새 기본값으로 승격 */
const DONOR_RANKINGS_LEGACY_OUTLINE_WIDTH = 2.25;

export const DEFAULT_DONOR_RANKINGS_THEME: DonorRankingsTheme = {
  top: DONOR_RANKINGS_COMPACT_TOP_MAX,
  titleText: "👑 웹후원 순위 👑",
  titleSize: 34,
  rowSize: 28,
  rankSize: 30,
  overlayOpacity: 88,
  bg: "transparent",
  /** 표·제목 뒤 패널 없음 — 방송 배경이 그대로 비침 */
  panelBg: "transparent",
  /** 패널 외곽 — 검정만 (골드 테두리 제외) */
  borderColor: "#000000",
  headerAccountBg: "transparent",
  headerToonBg: "transparent",
  rowEvenBg: "transparent",
  rowOddBg: "transparent",
  /** 4등 이후 순위 숫자: 흰색 / 제목·닉·금액: 골드 + 검정 외곽선 */
  rankColor: "#ffffff",
  nameColor: "#ffc107",
  amountColor: "#ffc107",
  titleColor: "#ffc107",
  outlineColor: "#000000",
  outlineWidth: 4,
  zoomPct: 100,
};

/** 후원순위 기본 제공 테마 5종 (관리자 원클릭 적용) */
export const BUILT_IN_DONOR_RANKINGS_PRESETS: DonorRankingsPreset[] = [
  {
    id: "dr_builtin_web_gold",
    name: "웹후원 골드",
    theme: { ...DEFAULT_DONOR_RANKINGS_THEME },
  },
  {
    id: "dr_builtin_neon_cyber",
    name: "네온 사이버",
    theme: {
      top: DONOR_RANKINGS_COMPACT_TOP_MAX,
      titleText: "⚡ 웹후원 순위 ⚡",
      titleSize: 32,
      rowSize: 26,
      rankSize: 28,
      overlayOpacity: 90,
      bg: "transparent",
      panelBg: "rgba(8, 12, 28, 0.78)",
      borderColor: "rgba(34, 211, 238, 0.35)",
      headerAccountBg: "linear-gradient(135deg, rgba(15,23,42,0.95) 0%, rgba(30,58,138,0.9) 100%)",
      headerToonBg: "linear-gradient(135deg, rgba(15,23,42,0.95) 0%, rgba(88,28,135,0.85) 100%)",
      rowEvenBg: "rgba(255, 255, 255, 0.04)",
      rowOddBg: "rgba(34, 211, 238, 0.08)",
      rankColor: "#67e8f9",
      nameColor: "#e0f2fe",
      amountColor: "#f0abfc",
      titleColor: "#22d3ee",
      outlineColor: "rgba(2, 6, 23, 0.95)",
      outlineWidth: 1.75,
      zoomPct: 100,
    },
  },
  {
    id: "dr_builtin_classic_pink",
    name: "클래식 핑크",
    theme: {
      top: DONOR_RANKINGS_COMPACT_TOP_MAX,
      titleText: "💖 후원 순위 💖",
      titleSize: 30,
      rowSize: 22,
      rankSize: 24,
      overlayOpacity: 96,
      bg: "transparent",
      panelBg: "rgba(255, 248, 252, 0.96)",
      borderColor: "rgba(244, 114, 182, 0.4)",
      headerAccountBg: "linear-gradient(135deg, #fce7f3 0%, #fbcfe8 48%, #f9a8d4 100%)",
      headerToonBg: "linear-gradient(135deg, #fdf2f8 0%, #f9a8d4 100%)",
      rowEvenBg: "rgba(255, 228, 240, 0.35)",
      rowOddBg: "transparent",
      rankColor: "#be185d",
      nameColor: "#831843",
      amountColor: "#b45309",
      titleColor: "#9d174d",
      outlineColor: "rgba(255, 255, 255, 0.85)",
      outlineWidth: 1.25,
      zoomPct: 100,
    },
  },
  {
    id: "dr_builtin_midnight",
    name: "미드나잇",
    theme: {
      top: DONOR_RANKINGS_COMPACT_TOP_MAX,
      titleText: "🌙 웹후원 순위 🌙",
      titleSize: 32,
      rowSize: 26,
      rankSize: 28,
      overlayOpacity: 92,
      bg: "transparent",
      panelBg: "rgba(15, 17, 23, 0.82)",
      borderColor: "rgba(148, 163, 184, 0.25)",
      headerAccountBg: "rgba(30, 41, 59, 0.92)",
      headerToonBg: "rgba(30, 41, 59, 0.92)",
      rowEvenBg: "rgba(255, 255, 255, 0.03)",
      rowOddBg: "rgba(255, 255, 255, 0.07)",
      rankColor: "#f8fafc",
      nameColor: "#f1f5f9",
      amountColor: "#fde68a",
      titleColor: "#f8fafc",
      outlineColor: "rgba(0, 0, 0, 0.88)",
      outlineWidth: 1.5,
      zoomPct: 100,
    },
  },
  {
    id: "dr_builtin_emerald",
    name: "에메랄드",
    theme: {
      top: DONOR_RANKINGS_COMPACT_TOP_MAX,
      titleText: "✨ 웹후원 순위 ✨",
      titleSize: 32,
      rowSize: 26,
      rankSize: 28,
      overlayOpacity: 90,
      bg: "transparent",
      panelBg: "rgba(236, 253, 245, 0.78)",
      borderColor: "rgba(16, 185, 129, 0.35)",
      headerAccountBg: "linear-gradient(135deg, #d1fae5 0%, #a7f3d0 50%, #6ee7b7 100%)",
      headerToonBg: "linear-gradient(135deg, #ecfdf5 0%, #6ee7b7 100%)",
      rowEvenBg: "rgba(167, 243, 208, 0.28)",
      rowOddBg: "transparent",
      rankColor: "#064e3b",
      nameColor: "#065f46",
      amountColor: "#b45309",
      titleColor: "#064e3b",
      outlineColor: "rgba(255, 255, 255, 0.9)",
      outlineWidth: 1.35,
      zoomPct: 100,
    },
  },
];

const BUILT_IN_DONOR_RANKINGS_PRESET_IDS = new Set(
  BUILT_IN_DONOR_RANKINGS_PRESETS.map((p) => p.id)
);

export function isBuiltInDonorRankingsPresetId(id: string | null | undefined): boolean {
  return Boolean(id && BUILT_IN_DONOR_RANKINGS_PRESET_IDS.has(id));
}

/** 기본 5종을 앞에 두고, 사용자 커스텀 프리셋을 뒤에 유지 */
export function mergeBuiltInDonorRankingsPresets(
  existing: DonorRankingsPreset[] | null | undefined
): DonorRankingsPreset[] {
  const list = Array.isArray(existing) ? existing : [];
  const byId = new Map(list.map((p) => [p.id, p]));
  const merged: DonorRankingsPreset[] = BUILT_IN_DONOR_RANKINGS_PRESETS.map((builtIn) => {
    const prev = byId.get(builtIn.id);
    /** 빌트인 id는 카탈로그 테마를 정본으로 — 이름만 사용자가 바꿔 둔 경우 유지 */
    return {
      id: builtIn.id,
      name: prev?.name?.trim() ? prev.name : builtIn.name,
      theme: { ...builtIn.theme },
    };
  });
  for (const p of list) {
    if (!BUILT_IN_DONOR_RANKINGS_PRESET_IDS.has(p.id)) merged.push(p);
  }
  return merged;
}

/** @deprecated 후원순위 전체(분홍) UI·라우트 제거 — Redis 호환용 기본값만 유지 */
export const DEFAULT_DONOR_RANKINGS_FULL_THEME: DonorRankingsTheme = {
  top: 0,
  titleText: "👑 후원 순위 👑",
  titleSize: 26,
  rowSize: 17,
  rankSize: 19,
  overlayOpacity: 88,
  bg: "transparent",
  panelBg: "rgba(255, 236, 246, 0.96)",
  borderColor: "rgba(244, 114, 182, 0.5)",
  headerAccountBg: "linear-gradient(135deg, #fce7f3 0%, #fbcfe8 48%, #f9a8d4 100%)",
  headerToonBg: "linear-gradient(135deg, #fdf2f8 0%, #f9a8d4 100%)",
  rowEvenBg: "rgba(255, 228, 240, 0.35)",
  rowOddBg: "transparent",
  rankColor: "#be185d",
  nameColor: "#831843",
  amountColor: "#b45309",
  titleColor: "#9d174d",
  outlineColor: "rgba(255, 255, 255, 0.82)",
  outlineWidth: 1.25,
  zoomPct: 100,
};

function normalizeDonorRankingsTheme(
  input: unknown,
  defaults: DonorRankingsTheme = DEFAULT_DONOR_RANKINGS_THEME
): DonorRankingsTheme {
  const v = input && typeof input === "object" ? (input as Partial<DonorRankingsTheme>) : {};
  const n = (x: unknown, min: number, max: number, fallback: number) => {
    const parsed = Number(x);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(parsed)));
  };
  const s = (x: unknown, fallback: string) => {
    const raw = String(x ?? "").trim();
    return raw || fallback;
  };
  const titleText = (() => {
    const raw = String(v.titleText ?? "").trim();
    if (!raw) return defaults.titleText;
    return raw.slice(0, 60);
  })();
  const compactTheme = defaults !== DEFAULT_DONOR_RANKINGS_FULL_THEME;
  const topMin = compactTheme ? 1 : 0;
  const topMax = compactTheme ? DONOR_RANKINGS_COMPACT_TOP_MAX : 50;
  const topParsed = n(v.top, topMin, topMax, defaults.top);
  /** 구버전 기본 7명 → 10명 */
  const top =
    compactTheme && topParsed === 7 ? defaults.top : topParsed;
  return {
    top,
    titleText,
    titleSize: n(v.titleSize, 14, 80, defaults.titleSize),
    rowSize: n(v.rowSize, 12, 64, defaults.rowSize),
    rankSize: n(v.rankSize, 12, 72, defaults.rankSize),
    overlayOpacity: n(v.overlayOpacity, 0, 100, defaults.overlayOpacity),
    bg: s(v.bg, defaults.bg),
    panelBg: (() => {
      const c = s(v.panelBg, defaults.panelBg);
      /** 구버전 밝은 회색 패널 → 투명(방송 배경 노출) */
      if (
        /^rgba\(\s*232\s*,\s*232\s*,\s*236\s*,\s*0\.7\s*\)$/i.test(c) ||
        /^rgba\(\s*232\s*,\s*232\s*,\s*236\s*,\s*0\.70\s*\)$/i.test(c)
      ) {
        return defaults.panelBg;
      }
      return c;
    })(),
    borderColor: (() => {
      const c = s(v.borderColor, defaults.borderColor);
      if (!compactTheme) return c;
      /** 구버전 transparent·골드 패널 테두리 → 검정 기본 */
      if (!c || c.toLowerCase() === "transparent" || /^#ffc107$/i.test(c)) {
        return defaults.borderColor;
      }
      return c;
    })(),
    headerAccountBg: (() => {
      const c = s(v.headerAccountBg, defaults.headerAccountBg);
      if (/^rgba\(\s*232\s*,\s*232\s*,\s*236\s*,\s*0\.55\s*\)$/i.test(c)) {
        return defaults.headerAccountBg;
      }
      return c;
    })(),
    headerToonBg: (() => {
      const c = s(v.headerToonBg, defaults.headerToonBg);
      if (/^rgba\(\s*232\s*,\s*232\s*,\s*236\s*,\s*0\.55\s*\)$/i.test(c)) {
        return defaults.headerToonBg;
      }
      return c;
    })(),
    rowEvenBg: s(v.rowEvenBg, defaults.rowEvenBg),
    rowOddBg: (() => {
      const c = s(v.rowOddBg, defaults.rowOddBg);
      /** 구버전 기본 줄무늬 → 투명 */
      if (/^rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0\.14\s*\)$/i.test(c)) {
        return defaults.rowOddBg;
      }
      return c;
    })(),
    rankColor: (() => {
      const c = s(v.rankColor, defaults.rankColor);
      /** 구버전 골드 순위 숫자 → 흰색 */
      if (compactTheme && /^#ffc107$/i.test(c)) return defaults.rankColor;
      return c;
    })(),
    nameColor: s(v.nameColor, defaults.nameColor),
    amountColor: s(v.amountColor, defaults.amountColor),
    titleColor: (() => {
      const c = s(v.titleColor, defaults.titleColor);
      if (compactTheme && /^#fff(?:fff)?$/i.test(c)) return defaults.titleColor;
      return c;
    })(),
    outlineColor: (() => {
      const c = s(v.outlineColor, defaults.outlineColor);
      if (compactTheme && /^rgba\(\s*20\s*,\s*12\s*,\s*6\s*,\s*0\.96\s*\)$/i.test(c)) {
        return defaults.outlineColor;
      }
      return c;
    })(),
    outlineWidth: (() => {
      const raw = v.outlineWidth;
      if (raw === undefined || raw === null) return defaults.outlineWidth;
      const parsed = typeof raw === "number" ? raw : parseFloat(String(raw));
      if (!Number.isFinite(parsed)) return defaults.outlineWidth;
      if (
        compactTheme &&
        Math.abs(parsed - DONOR_RANKINGS_LEGACY_OUTLINE_WIDTH) < 0.01
      ) {
        return defaults.outlineWidth;
      }
      return Math.max(0, Math.min(DONOR_RANKINGS_OUTLINE_MAX_PX, Math.round(parsed * 100) / 100));
    })(),
    zoomPct: n(v.zoomPct, 30, 300, defaults.zoomPct ?? 100),
  };
}

export function normalizeDonorRankingsFullTheme(input: unknown): DonorRankingsTheme {
  return normalizeDonorRankingsTheme(input, DEFAULT_DONOR_RANKINGS_FULL_THEME);
}

/** 후원순위 테마가 기본값과 동일한지(원격 기본값으로 로컬 커스텀을 덮지 않기 위함) */
/** 오버레이 프리셋이 기본(핑크 그라데이션)인지 — 커스텀 테마·색상 덮어쓰기 방지용 */
export function isDefaultLikeOverlayPresets(presets: unknown): boolean {
  if (!Array.isArray(presets) || presets.length === 0) return true;
  const p = presets[0] as Record<string, unknown>;
  if (!p || typeof p !== "object") return true;
  if (String(p.theme || "default") !== "default") return false;
  if (String(p.membersTheme || "auto") !== "auto") return false;
  if (String(p.totalTheme || "auto") !== "auto") return false;
  const colorKeys = [
    "tableBgColor",
    "tableHeaderBgColor",
    "tableHeaderTextColor",
    "tableLineColor",
    "accountColor",
    "toonColor",
    "contributionColor",
    "tableRowEvenBg",
    "tableRowOddBg",
    "tablePanelBorderColor",
    "tableBgGifUrl",
    "tableFrameUrl",
  ];
  return !colorKeys.some((k) => typeof p[k] === "string" && String(p[k]).trim());
}

export function pickOverlayPresetsPreferCustom(
  fresh: AppState["overlayPresets"] | undefined,
  hint: AppState["overlayPresets"] | undefined
): AppState["overlayPresets"] {
  const freshDefault = isDefaultLikeOverlayPresets(fresh);
  const hintDefault = isDefaultLikeOverlayPresets(hint);
  if (!hintDefault && freshDefault) return hint ?? fresh ?? [];
  if (!freshDefault && hintDefault) return fresh ?? [];
  if ((hint?.length || 0) >= (fresh?.length || 0)) return hint ?? fresh ?? [];
  return fresh ?? hint ?? [];
}

export function isDefaultLikeDonorRankingsTheme(
  theme: DonorRankingsTheme | null | undefined,
  defaults: DonorRankingsTheme = DEFAULT_DONOR_RANKINGS_THEME
): boolean {
  if (!theme || typeof theme !== "object") return true;
  const n = normalizeDonorRankingsTheme(theme, defaults);
  const d = defaults;
  return (
    n.top === d.top &&
    n.titleText === d.titleText &&
    n.titleSize === d.titleSize &&
    n.rowSize === d.rowSize &&
    n.rankSize === d.rankSize &&
    n.overlayOpacity === d.overlayOpacity &&
    n.bg === d.bg &&
    n.panelBg === d.panelBg &&
    n.borderColor === d.borderColor &&
    n.headerAccountBg === d.headerAccountBg &&
    n.headerToonBg === d.headerToonBg &&
    n.rowEvenBg === d.rowEvenBg &&
    n.rowOddBg === d.rowOddBg &&
    n.rankColor === d.rankColor &&
    n.nameColor === d.nameColor &&
    n.amountColor === d.amountColor &&
    n.titleColor === d.titleColor &&
    n.outlineColor === d.outlineColor &&
    n.outlineWidth === d.outlineWidth &&
    n.zoomPct === d.zoomPct
  );
}

function normalizeDonorRankingsPresets(input: unknown): DonorRankingsPreset[] {
  if (!Array.isArray(input)) return mergeBuiltInDonorRankingsPresets([]);
  const normalized = input
    .filter((x) => x && typeof x === "object")
    .map((x, idx) => {
      const o = x as Record<string, unknown>;
      const id = typeof o.id === "string" && o.id.trim() ? o.id.trim() : `drp_${idx}_${Math.random().toString(36).slice(2, 6)}`;
      const name = typeof o.name === "string" && o.name.trim() ? o.name.trim() : `프리셋 ${idx + 1}`;
      return {
        id,
        name,
        theme: normalizeDonorRankingsTheme(o.theme),
      };
    });
  return mergeBuiltInDonorRankingsPresets(normalized);
}

/** 동기화 오류 시 members가 missions에 섞이는 것 방지. title/price가 있는 항목만 반환 */
export function ensureMissionItems(items: unknown[] | undefined | null): MissionItem[] {
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

/** 동기화 오류 시 missions가 members에 섞이는 것 방지. name이 있고 title이 없는 항목만 반환 */
export function ensureMembers(items: unknown[] | undefined | null): Member[] {
  if (!Array.isArray(items)) return [];
  return items.filter((x): x is Member => {
    if (!x || typeof x !== "object") return false;
    const t = x as Record<string, unknown>;
    return typeof t.name === "string" && typeof t.title !== "string";
  }).map((m) => normalizeMember(m as Member));
}

export const STORAGE_KEY = "excel-broadcast-state-v1";
export const DAILY_LOG_KEY = "excel-broadcast-daily-log-v1";
export const FORBID_EVENTS_KEY = "excel-broadcast-forbid-events-v1";
export const MISSIONS_BACKUP_KEY = "excel-broadcast-missions-backup-v1";

export function storageKey(userId?: string | null): string {
  return userId ? `${STORAGE_KEY}:${userId}` : STORAGE_KEY;
}

/** 세션 캐시(+비권한 모드에서만 LS) — 서버 정본 모드에서는 LS 기록 금지 */
function writeBroadcastStateSnapshot(state: AppState, userId?: string | null): void {
  writeSessionBroadcastState(state, userId);
  if (!isServerAuthoritativeBroadcastState() && typeof window !== "undefined") {
    try {
      window.localStorage.setItem(storageKey(userId), JSON.stringify(state));
    } catch {}
  }
}

/** admin·투네 등 즉시 iframe 반영 — LS 없이 세션 캐시 + 이벤트만 */
export function cacheBroadcastStateSnapshot(state: AppState, userId?: string | null): void {
  writeBroadcastStateSnapshot(state, userId);
  notifyBroadcastStateLocalUpdated(userId, state.updatedAt);
}
export function dailyLogStorageKey(userId?: string | null): string {
  return userId ? `${DAILY_LOG_KEY}:${userId}` : DAILY_LOG_KEY;
}
export function missionsBackupKey(userId?: string | null): string {
  return userId ? `${MISSIONS_BACKUP_KEY}:${userId}` : MISSIONS_BACKUP_KEY;
}

/** 계정별 오버레이 프리SET localStorage 캐시 키 (서버 AppState.overlayPresets 가 정본) */
export function overlayPresetsStorageKey(userId?: string | null): string {
  const uid = String(userId || "finalent").trim() || "finalent";
  return `excel-broadcast-overlay-presets:${uid}`;
}

/** @deprecated 구버전 localStorage 캐시 — settlementUiOptions(AppState)가 정본 */
export function settlementOptionsStorageKey(userId?: string | null): string {
  const uid = String(userId || "finalent").trim() || "finalent";
  return `excel-broadcast-settlement-options-v1:${uid}`;
}

/** 구버전(계정 미분리) 키 → 계정별 키로 1회 이전 */
export function migrateLegacyLocalStorageKey(
  legacyKey: string,
  scopedKey: string
): string | null {
  if (typeof window === "undefined") return null;
  if (isServerAuthoritativeBroadcastState()) return null;
  try {
    const scoped = window.localStorage.getItem(scopedKey);
    if (scoped) return scoped;
    const legacy = window.localStorage.getItem(legacyKey);
    if (legacy) {
      window.localStorage.setItem(scopedKey, legacy);
      return legacy;
    }
  } catch {}
  return null;
}

export function saveMissionsBackup(missions: MissionItem[], userId?: string | null): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(missionsBackupKey(userId), JSON.stringify(missions));
  } catch {}
}

export function loadMissionsBackup(userId?: string | null): MissionItem[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(missionsBackupKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed as MissionItem[];
  } catch {
    return null;
  }
}

export function defaultMembers(): Member[] {
  return buildDefaultMembersCount(3);
}

/** 정산「멤버 초기화」 시 멤버 슬롯 수(1~30). id 는 m1… 순서 */
export function buildDefaultMembersCount(count: number): Member[] {
  const n = Math.max(1, Math.min(30, Math.floor(Number(count) || 0)));
  return Array.from({ length: n }, (_, i) => {
    const idx = i + 1;
    return {
      id: `m${idx}`,
      name: `멤버${idx}`,
      realName: "",
      account: 0,
      toon: 0,
      contribution: 0,
      restroom: 0,
      operating: false,
    };
  });
}

/** Redis/API·엑셀 등에서 금액이 문자열·콤마 문자열로 올 때 복원 */
function parseOptionalNonNegativeMoney(input: unknown): number | undefined {
  if (input === undefined || input === null) return undefined;
  if (typeof input === "number" && Number.isFinite(input)) return Math.max(0, Math.floor(input));
  if (typeof input === "string") {
    const t = input.replace(/,/g, "").trim();
    if (t === "") return undefined;
    const n = Number(t);
    if (!Number.isFinite(n)) return undefined;
    return Math.max(0, Math.floor(n));
  }
  return undefined;
}

function normalizeMember(m: Member): Member {
  const rec = m as Record<string, unknown>;
  const goalParsed = parseOptionalNonNegativeMoney(rec.goal);
  const goal = goalParsed !== undefined ? goalParsed : undefined;
  const contribution = parseOptionalNonNegativeMoney(rec.contribution) ?? 0;
  const restroom = normalizeRestroomCount(rec.restroom);
  const account = parseOptionalNonNegativeMoney(rec.account) ?? 0;
  const toon = parseOptionalNonNegativeMoney(rec.toon) ?? 0;
  return {
    ...m,
    realName: m.realName ?? "",
    account,
    toon,
    contribution,
    restroom,
    goal,
    operating:
      Boolean(m.operating) ||
      /운영비/i.test(String(m.name || "")) ||
      /운영비/i.test(String(m.realName || "")),
  };
}

/** 직급은 멤버와 분리 저장: memberId -> 직급 */
export function normalizeMemberPositions(
  raw: unknown,
  members: Member[]
): Record<string, string> {
  const validIds = new Set((members || []).map((m) => m.id));
  const out: Record<string, string> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [id, val] of Object.entries(raw as Record<string, unknown>)) {
      if (!validIds.has(id)) continue;
      const role = String(val ?? "").trim();
      if (!role) continue;
      out[id] = role;
    }
  }
  // 하위호환: 기존 member.role 값이 있으면 초기 직급으로 채움
  for (const m of members || []) {
    if (out[m.id]) continue;
    const legacy = String((m as unknown as { role?: string }).role || "").trim();
    if (legacy) out[m.id] = legacy;
  }
  return out;
}

function normalizeMemberPositionMode(input: unknown): AppState["memberPositionMode"] {
  return input === "rankLinked" ? "rankLinked" : "fixed";
}

/** 순위 연동 직급 라벨 상한(멤버 수 연동, 비정상 배열 방지) */
export const MAX_RANK_POSITION_LABELS = 100;

/** 저장·로드용 — 길이 고정(12) 없이 입력 배열을 그대로 정규화 */
export function normalizeRankPositionLabels(input: unknown): string[] {
  if (!Array.isArray(input)) return ["대표"];
  const labels = input
    .map((x) => String(x ?? "").trim())
    .slice(0, MAX_RANK_POSITION_LABELS);
  return labels.length > 0 ? labels : ["대표"];
}

/** 멤버 수만큼 직급 라벨 슬롯을 맞춤(부족분은 빈 문자열, 초과분은 잘라냄) */
export function fitRankPositionLabelsToMemberCount(
  labels: string[] | null | undefined,
  memberCount: number
): string[] {
  const n = Math.max(
    1,
    Math.min(MAX_RANK_POSITION_LABELS, Math.floor(Number(memberCount) || 1))
  );
  const src = normalizeRankPositionLabels(labels);
  return Array.from({ length: n }, (_, i) => String(src[i] || "").trim());
}

function normalizeOverlayBodyImagePosition(input: unknown): OverlayConfig["bodyImagePosition"] {
  const raw = String(input || "").trim();
  if (raw === "abovePanel" || raw === "belowList") return raw;
  return "belowTitle";
}

export function normalizeDonationListsOverlayConfig(input: unknown): OverlayConfig {
  const v = input && typeof input === "object" ? (input as Partial<OverlayConfig>) : {};
  const urlRaw = typeof v.bgGifUrl === "string" ? v.bgGifUrl.trim() : "";
  let op = Number(v.bgOpacity);
  if (!Number.isFinite(op)) op = 40;
  op = Math.max(0, Math.min(100, Math.round(op)));
  const bgGifUrl = sanitizeOverlayEmbedMediaUrl(urlRaw);
  const bodyUrlRaw = typeof v.bodyImageUrl === "string" ? v.bodyImageUrl.trim() : "";
  const bodyImageUrl = sanitizeOverlayEmbedMediaUrl(bodyUrlRaw);
  let bodyOp = Number(v.bodyImageOpacity);
  if (!Number.isFinite(bodyOp)) bodyOp = 100;
  bodyOp = Math.max(0, Math.min(100, Math.round(bodyOp)));
  const frameUrlRaw = typeof v.frameUrl === "string" ? v.frameUrl.trim() : "";
  const frameUrl = sanitizeOverlayEmbedMediaUrl(frameUrlRaw);
  let frameOp = Number(v.frameOpacity);
  if (!Number.isFinite(frameOp)) frameOp = 100;
  frameOp = Math.max(0, Math.min(100, Math.round(frameOp)));
  let frameInset = Number(v.frameInset);
  if (!Number.isFinite(frameInset)) frameInset = 32;
  frameInset = Math.max(0, Math.min(120, Math.round(frameInset)));
  return {
    bgGifUrl,
    bgOpacity: op,
    isBgEnabled: bgGifUrl ? v.isBgEnabled !== false : false,
    bodyImageUrl,
    bodyImageOpacity: bodyOp,
    isBodyImageEnabled: Boolean(bodyImageUrl && v.isBodyImageEnabled),
    bodyImagePosition: normalizeOverlayBodyImagePosition(v.bodyImagePosition),
    frameUrl,
    frameOpacity: frameOp,
    frameInset,
    isFrameEnabled: Boolean(frameUrl && v.isFrameEnabled),
  };
}

export function normalizeDonorRankingsOverlayConfig(input: unknown): OverlayConfig {
  return normalizeDonationListsOverlayConfig(input);
}

/** 오버레이 프리셋에 남은 ImageKit 등 외부 GIF URL 제거(로드·저장 공통) */
function normalizeOverlayPresetsMedia(input: unknown): unknown[] {
  if (!Array.isArray(input)) return [];
  const withMedia = input.map((p) => {
    if (!p || typeof p !== "object") return p;
    const o = p as Record<string, unknown>;
    const next = { ...o };
    if (typeof o.tableBgGifUrl === "string") {
      next.tableBgGifUrl = sanitizeOverlayEmbedMediaUrl(o.tableBgGifUrl);
    }
    if (typeof o.tableFrameUrl === "string") {
      next.tableFrameUrl = sanitizeOverlayEmbedMediaUrl(o.tableFrameUrl);
    }
    if (typeof o.goalBarGifUrl === "string") {
      next.goalBarGifUrl = sanitizeOverlayEmbedMediaUrl(o.goalBarGifUrl);
    }
    return next;
  });
  return normalizeOverlayPresetDonationGoals(withMedia) as unknown[];
}

function normalizeSigSalesExcludedIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of input) {
    const id = String(x || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function defaultState(): AppState {
  const defaultTimer: TimerState = { remainingTime: 0, isActive: false, lastUpdated: 0 };
  const defaultMealBattle: MealBattleState = {
    participants: [],
    memberGaugeColors: {},
    overlayTitle: "식사 대전",
    currentMission: "",
    overlayRulesText: "",
    overlayRulesFontSize: 16,
    donationTableOptions: normalizeDonationTableColumnsOptions(null),
    totalGoal: 100,
    timerTheme: "default",
    timerSize: 36,
    missionBubbleBg: "#9333ea",
    missionBubbleTextColor: "#ffffff",
    gaugeTrackBg: "rgba(23,23,23,0.85)",
    gaugeTrackBorderColor: "rgba(255,255,255,0.2)",
    gaugeFillColor: "#22c55e",
    scoreTextColor: "#ffffff",
    nameTagBg: "#facc15",
    nameTagTextColor: "#000000",
    showPanelBorder: false,
    panelBorderColor: "rgba(255,255,255,0.25)",
    showGaugeTrackBorder: false,
    teamBattleEnabled: false,
    teamAName: "A팀",
    teamBName: "B팀",
    teamAGoal: 0,
    teamBGoal: 0,
    teamAMemberIds: [],
    teamBMemberIds: [],
    teamAColor: "#2563eb",
    teamBColor: "#dc2626",
    gaugeEffects: { ...DEFAULT_MEAL_GAUGE_EFFECTS },
  };
  const defaultMealSettings: MealMatchSettings = {
    isActive: false,
    title: "식사 대전",
    mode: "team",
    targetScore: 100,
    teamAName: "Team A",
    teamBName: "Team B",
    teamAMemberIds: ["m1"],
    teamBMemberIds: ["m2"],
  };
  return {
    members: defaultMembers(),
    memberPositions: {},
    memberPositionMode: "fixed",
    rankPositionLabels: fitRankPositionLabelsToMemberCount(["대표"], defaultMembers().length),
    donorRankingsTheme: { ...DEFAULT_DONOR_RANKINGS_THEME },
    donorRankingsFullTheme: { ...DEFAULT_DONOR_RANKINGS_FULL_THEME },
    donorRankingsPresets: mergeBuiltInDonorRankingsPresets([]),
    donorRankingsPresetId: "dr_builtin_web_gold",
    donors: [],
    donorsFormat: "full",
    contributionFormula: { ...DEFAULT_CONTRIBUTION_FORMULA },
    contributionLogs: [],
    restroomLogs: [],
    territoryLogs: [],
    forbiddenWords: ["금칙어", "욕설", "비속어"],
    sigInventory: DEFAULT_SIG_INVENTORY.map((x) => ({ ...x })),
    sigSoldOutStampUrl: "",
    sigSalesMemberPresets: {},
    sigSalesExcludedIds: [],
    rouletteState: normalizeRouletteState(null),
    overlayPresets: [],
    sigMatch: {},
    mealBattle: defaultMealBattle,
    mealMatch: {},
    sigMatchSettings: {
      isActive: false,
      targetCount: 100,
      title: "시그 대전",
      keyword: "시그",
      signatureAmounts: [77, 100, 333],
      scoringMode: "amount",
      countAllDonations: true,
      incentivePerPoint: 1000,
      manualAddStep: 10_000,
      manualDeductStep: 10_000,
      sigMatchPools: [],
      participantMemberIds: [],
      donationLinks: {},
      overlayTimerDurationSec: 180,
      overlayTimerEndAt: null,
      rulesText: "",
      rulesFontSize: 16,
      donationTableOptions: normalizeDonationTableColumnsOptions(null),
    },
    mealMatchSettings: defaultMealSettings,
    generalTimer: { ...defaultTimer },
    matchTimer: { ...defaultTimer },
    matchTimerEnabled: { general: true, match: true },
    timerDisplayStyles: {
      general: defaultTimerDisplayStyle(),
    },
    donorRankingsOverlayConfig: normalizeDonorRankingsOverlayConfig(null),
    donorRankingsFullOverlayConfig: normalizeDonorRankingsOverlayConfig(null),
    donationListsOverlayConfig: normalizeDonationListsOverlayConfig(null),
    donationSyncMode: "mealBattle",
    highSocietySettings: {
      enabled: false,
      seatMemberIds: [],
      defaultMiddlePush: "right",
      defaultBPush: "right",
      defaultCPush: "right",
      barStyle: "flat",
      round: 1,
      fieldCm: 1200,
      startCmPerMember: 300,
      fx: {
        frontier: false,
        growFlash: false,
        contestedEdge: false,
        arrowBlade: false,
        strongOutline: false,
      },
    },
    sigRolling: normalizeSigRolling(null),
    sigRollingMeta: {},
    updatedAt: Date.now(),
    donorRankingsUpdatedAt: Date.now(),
  };
}

function normalizeMealBattle(input: unknown): MealBattleState {
  const v = input && typeof input === "object" ? (input as Partial<MealBattleState>) : {};
  const rawGaugeColors = (v as Record<string, unknown>).memberGaugeColors;
  const memberGaugeColors =
    rawGaugeColors && typeof rawGaugeColors === "object" && !Array.isArray(rawGaugeColors)
      ? Object.fromEntries(
          Object.entries(rawGaugeColors as Record<string, unknown>)
            .filter(([key, val]) => typeof key === "string" && typeof val === "string" && String(val).trim())
            .map(([key, val]) => [key, String(val).trim()])
        )
      : {};
  const otRaw = typeof v.overlayTitle === "string" ? v.overlayTitle.trim() : "";
  const cmRaw = typeof v.currentMission === "string" ? v.currentMission.trim() : "";
  const orRaw =
    typeof (v as Record<string, unknown>).overlayRulesText === "string"
      ? String((v as Record<string, unknown>).overlayRulesText).trim()
      : "";
  const totalGoal = Number.isFinite(v.totalGoal) ? Math.max(1, Math.floor(v.totalGoal as number)) : 100;
  const participantsWithGoals = Array.isArray(v.participants)
    ? v.participants
        .filter((x) => Boolean(x && typeof x === "object"))
        .map((x) => {
          const goalRaw = (x as Record<string, unknown>).goal;
          const goalNum = Number(goalRaw);
          const goal =
            goalRaw !== undefined && goalRaw !== null && Number.isFinite(goalNum) ? Math.max(1, Math.floor(goalNum)) : totalGoal;
          return {
            memberId: String((x as Record<string, unknown>).memberId || ""),
            name: String((x as Record<string, unknown>).name || ""),
            score: Math.max(0, Math.floor(Number((x as Record<string, unknown>).score || 0) || 0)),
            goal,
            color: String((x as Record<string, unknown>).color || "#60a5fa"),
            donationLinkActive: Boolean((x as Record<string, unknown>).donationLinkActive),
            donationLinkStartedAt: Number.isFinite(Number((x as Record<string, unknown>).donationLinkStartedAt))
              ? Math.max(0, Math.floor(Number((x as Record<string, unknown>).donationLinkStartedAt)))
              : undefined,
          };
        })
        .filter((x) => Boolean(x.memberId))
    : [];
  return {
    participants: participantsWithGoals,
    memberGaugeColors,
    overlayTitle: otRaw || "식사 대전",
    currentMission: cmRaw,
    overlayRulesText: orRaw,
    overlayRulesFontSize: (() => {
      const n = Number((v as Record<string, unknown>).overlayRulesFontSize);
      if (!Number.isFinite(n)) return 16;
      return Math.max(10, Math.min(36, Math.round(n)));
    })(),
    totalGoal,
    timerTheme: v.timerTheme === "neon" || v.timerTheme === "minimal" || v.timerTheme === "danger" ? v.timerTheme : "default",
    timerSize: Number.isFinite(v.timerSize) ? Math.max(16, Math.min(120, Math.floor(v.timerSize as number))) : 36,
    missionBubbleBg: String((v as Record<string, unknown>).missionBubbleBg || "#9333ea"),
    missionBubbleTextColor: String((v as Record<string, unknown>).missionBubbleTextColor || "#ffffff"),
    gaugeTrackBg: String((v as Record<string, unknown>).gaugeTrackBg || "rgba(23,23,23,0.85)"),
    gaugeTrackBorderColor: String((v as Record<string, unknown>).gaugeTrackBorderColor || "rgba(255,255,255,0.2)"),
    gaugeFillColor: String((v as Record<string, unknown>).gaugeFillColor || "#22c55e"),
    scoreTextColor: String((v as Record<string, unknown>).scoreTextColor || "#ffffff"),
    nameTagBg: String((v as Record<string, unknown>).nameTagBg || "#facc15"),
    nameTagTextColor: String((v as Record<string, unknown>).nameTagTextColor || "#000000"),
    showPanelBorder: typeof (v as Record<string, unknown>).showPanelBorder === "boolean" ? Boolean((v as Record<string, unknown>).showPanelBorder) : false,
    panelBorderColor: String((v as Record<string, unknown>).panelBorderColor || "rgba(255,255,255,0.25)"),
    showGaugeTrackBorder: typeof (v as Record<string, unknown>).showGaugeTrackBorder === "boolean"
      ? Boolean((v as Record<string, unknown>).showGaugeTrackBorder)
      : false,
    teamBattleEnabled: Boolean((v as Record<string, unknown>).teamBattleEnabled),
    scoreUsesRawDonationAmount:
      typeof (v as Record<string, unknown>).scoreUsesRawDonationAmount === "boolean"
        ? Boolean((v as Record<string, unknown>).scoreUsesRawDonationAmount)
        : Boolean((v as Record<string, unknown>).teamBattleEnabled),
    teamAName: typeof (v as Record<string, unknown>).teamAName === "string" && String((v as Record<string, unknown>).teamAName).trim()
      ? String((v as Record<string, unknown>).teamAName).trim()
      : "A팀",
    teamBName: typeof (v as Record<string, unknown>).teamBName === "string" && String((v as Record<string, unknown>).teamBName).trim()
      ? String((v as Record<string, unknown>).teamBName).trim()
      : "B팀",
    teamAGoal: Number.isFinite(Number((v as Record<string, unknown>).teamAGoal))
      ? Math.max(0, Math.floor(Number((v as Record<string, unknown>).teamAGoal)))
      : 0,
    teamBGoal: Number.isFinite(Number((v as Record<string, unknown>).teamBGoal))
      ? Math.max(0, Math.floor(Number((v as Record<string, unknown>).teamBGoal)))
      : 0,
    teamAMemberIds: Array.isArray((v as Record<string, unknown>).teamAMemberIds)
      ? ((v as Record<string, unknown>).teamAMemberIds as unknown[]).map((x) => String(x)).filter(Boolean)
      : [],
    teamBMemberIds: Array.isArray((v as Record<string, unknown>).teamBMemberIds)
      ? ((v as Record<string, unknown>).teamBMemberIds as unknown[]).map((x) => String(x)).filter(Boolean)
      : [],
    teamAColor: String((v as Record<string, unknown>).teamAColor || "#2563eb"),
    teamBColor: String((v as Record<string, unknown>).teamBColor || "#dc2626"),
    gaugeEffects: normalizeMealGaugeEffects((v as Record<string, unknown>).gaugeEffects),
    donationTableOptions: normalizeDonationTableColumnsOptions(
      (v as Record<string, unknown>).donationTableOptions as Parameters<
        typeof normalizeDonationTableColumnsOptions
      >[0]
    ),
  };
}

function normalizeMealMatchSettings(input: unknown): MealMatchSettings {
  const s = input && typeof input === "object" ? (input as Partial<MealMatchSettings>) : {};
  return {
    isActive: Boolean(s.isActive),
    title: typeof s.title === "string" && s.title.trim() ? s.title : "식사 대전",
    mode: s.mode === "individual" ? "individual" : "team",
    targetScore: Number.isFinite(s.targetScore) ? Math.max(1, Math.floor(s.targetScore as number)) : 100,
    teamAName: typeof s.teamAName === "string" && s.teamAName.trim() ? s.teamAName : "Team A",
    teamBName: typeof s.teamBName === "string" && s.teamBName.trim() ? s.teamBName : "Team B",
    teamAMemberIds: Array.isArray(s.teamAMemberIds) ? s.teamAMemberIds.map((x) => String(x)).filter(Boolean) : [],
    teamBMemberIds: Array.isArray(s.teamBMemberIds) ? s.teamBMemberIds.map((x) => String(x)).filter(Boolean) : [],
  };
}

function syncBattleStateWithMembers(data: AppState): AppState {
  const validMemberIds = new Set((data.members || []).map((m) => m.id));
  const memberById = new Map((data.members || []).map((m) => [m.id, m]));
  const positions = data.memberPositions || {};
  const isBattlePlayableId = (memberId: string) => {
    if (!validMemberIds.has(memberId)) return false;
    const m = memberById.get(memberId);
    if (!m) return false;
    return !isOperatingSettlementMember(m, positions);
  };

  const syncedMealBattle: MealBattleState = {
    ...data.mealBattle,
    participants: (data.mealBattle?.participants || []).filter((p) => isBattlePlayableId(p.memberId)),
    memberGaugeColors: Object.fromEntries(
      Object.entries(data.mealBattle?.memberGaugeColors || {}).filter(([memberId]) =>
        isBattlePlayableId(memberId)
      )
    ),
    teamAMemberIds: (data.mealBattle?.teamAMemberIds || []).filter((memberId) =>
      isBattlePlayableId(memberId)
    ),
    teamBMemberIds: (data.mealBattle?.teamBMemberIds || []).filter((memberId) =>
      isBattlePlayableId(memberId)
    ),
  };

  const syncedMealMatch = Object.fromEntries(
    Object.entries(data.mealMatch || {}).filter(([memberId]) => isBattlePlayableId(memberId))
  ) as AppState["mealMatch"];

  const syncedSigMatch = Object.fromEntries(
    Object.entries(data.sigMatch || {}).filter(([memberId]) => isBattlePlayableId(memberId))
  ) as AppState["sigMatch"];

  const syncedMealMatchSettings: MealMatchSettings = {
    ...data.mealMatchSettings,
    teamAMemberIds: (data.mealMatchSettings?.teamAMemberIds || []).filter((memberId) =>
      isBattlePlayableId(memberId)
    ),
    teamBMemberIds: (data.mealMatchSettings?.teamBMemberIds || []).filter((memberId) =>
      isBattlePlayableId(memberId)
    ),
  };

  const syncedSigMatchSettings: SigMatchSettings = {
    ...data.sigMatchSettings,
    participantMemberIds: (data.sigMatchSettings?.participantMemberIds || []).filter((memberId) =>
      isBattlePlayableId(memberId)
    ),
    sigMatchPools: (data.sigMatchSettings?.sigMatchPools || []).map((pool) => ({
      ...pool,
      memberIds: (pool.memberIds || []).filter((memberId) => isBattlePlayableId(memberId)),
    })),
  };

  return {
    ...data,
    mealBattle: syncedMealBattle,
    mealMatch: syncedMealMatch,
    sigMatch: syncedSigMatch,
    mealMatchSettings: syncedMealMatchSettings,
    sigMatchSettings: syncedSigMatchSettings,
  };
}

function normalizeTimerState(input: unknown): TimerState {
  const t = input && typeof input === "object" ? (input as Partial<TimerState>) : {};
  return {
    remainingTime: Number.isFinite(t.remainingTime) ? Math.max(0, Math.floor(t.remainingTime as number)) : 0,
    isActive: Boolean(t.isActive),
    /** missing → 0 (Date.now()면 stale {0,false}가 '최신 정지'로 오인되어 진행 타이머를 덮음) */
    lastUpdated: Number.isFinite(t.lastUpdated) ? Math.max(0, Math.floor(t.lastUpdated as number)) : 0,
  };
}

function normalizeMatchTimerEnabled(input: unknown): MatchTimerEnabled {
  const v = input && typeof input === "object" ? (input as Partial<MatchTimerEnabled>) : {};
  const general = typeof v.general === "boolean" ? v.general : true;
  return {
    general,
    match: typeof v.match === "boolean" ? v.match : general,
  };
}

function defaultTimerDisplayStyle(): TimerDisplayStyle {
  return {
    showHours: false,
    design: "pill",
    fontFamily: "mono",
    fontColor: "",
    bgColor: "",
    borderColor: "",
    outlineColor: "",
    outlineWidth: 0.8,
    bgOpacity: 40,
    scalePercent: 100,
  };
}

/** 타이머 표시 색·글꼴·외곽선이 전부 비어 기본값인지 */
export function isDefaultLikeTimerDisplayStyle(
  style: TimerDisplayStyle | null | undefined
): boolean {
  if (!style) return true;
  if (isHiddenTimerDisplayStyle(style)) return false;
  const font = String(style.fontFamily || "")
    .trim()
    .toLowerCase();
  const fontIsDefault = !font || font === "mono" || font === "default" || font === "auto";
  const bgOpacity = Number(style.bgOpacity);
  const scalePercent = Number(style.scalePercent);
  const outlineWidth = Number(style.outlineWidth);
  const outlineWidthIsDefault =
    !Number.isFinite(outlineWidth) || Math.abs(outlineWidth - 0.8) < 0.05;
  return (
    fontIsDefault &&
    isDefaultTimerDesign(style.design) &&
    !String(style.fontColor || "").trim() &&
    !String(style.bgColor || "").trim() &&
    !String(style.borderColor || "").trim() &&
    !String(style.outlineColor || "").trim() &&
    outlineWidthIsDefault &&
    (!Number.isFinite(bgOpacity) || bgOpacity === 40) &&
    (!Number.isFinite(scalePercent) || scalePercent === 100)
  );
}

export function hasCustomTimerDisplayStyles(
  styles: AppState["timerDisplayStyles"] | null | undefined
): boolean {
  return !isDefaultLikeTimerDisplayStyle(styles?.general);
}

/**
 * 오버레이 last-good 과 서버 스냅샷 병합.
 * 색이 기본값으로 비어도 last-good 커스텀 색은 지키되, **디자인(led-matrix 등)은 서버를 따른다.**
 */
export function mergeRemoteTimerDisplayStyles(opts: {
  last?: AppState["timerDisplayStyles"] | null;
  incoming?: AppState["timerDisplayStyles"] | null;
  hasIncomingKey: boolean;
}): AppState["timerDisplayStyles"] | undefined {
  const last = opts.last ?? undefined;
  const incoming = opts.incoming ?? undefined;
  const incomingHidden = isHiddenTimerDisplayStyle(incoming?.general);
  if (incomingHidden && incoming) return incoming;
  const preferLastColors =
    hasCustomTimerDisplayStyles(last) &&
    !incomingHidden &&
    (!opts.hasIncomingKey || isDefaultLikeTimerDisplayStyle(incoming?.general));
  const withIncomingDesign = (
    base: NonNullable<AppState["timerDisplayStyles"]>
  ): AppState["timerDisplayStyles"] => {
    const incomingDesign = incoming?.general?.design;
    if (!incomingDesign) return base;
    if (normalizeTimerDesign(incomingDesign) === normalizeTimerDesign(base.general?.design)) {
      return base;
    }
    return {
      general: {
        ...base.general,
        design: normalizeTimerDesign(incomingDesign),
        fontFamily: incoming?.general?.fontFamily || base.general.fontFamily,
        showHours: incoming?.general?.showHours ?? base.general.showHours,
        scalePercent: incoming?.general?.scalePercent ?? base.general.scalePercent,
      },
    };
  };
  if (preferLastColors && last) {
    return withIncomingDesign(last);
  }
  if (!opts.hasIncomingKey && last && !isHiddenTimerDisplayStyle(last.general)) return last;
  if (incoming && last && hasCustomTimerDisplayStyles(last)) {
    return withIncomingDesign({
      general: {
        ...last.general,
        ...incoming.general,
        fontColor: incoming.general.fontColor || last.general.fontColor,
        bgColor: incoming.general.bgColor || last.general.bgColor,
        borderColor: incoming.general.borderColor || last.general.borderColor,
        outlineColor: incoming.general.outlineColor || last.general.outlineColor,
      },
    });
  }
  return incoming ?? last;
}

/** 테마·타이머 PATCH — foundation(방금 UI 반영) vs LS 중 최신 timerDisplayStyles 선택 */
export function resolveTimerDisplayStylesForVisualSave(
  foundation: AppState | null | undefined,
  local: AppState | null | undefined,
  base: AppState | null | undefined
): AppState["timerDisplayStyles"] {
  const foundationStyles = foundation?.timerDisplayStyles;
  const localStyles = local?.timerDisplayStyles;
  const baseStyles = base?.timerDisplayStyles ?? normalizeTimerDisplayStyles(undefined);
  const foundationAt = Number(foundation?.updatedAt || 0);
  const localAt = Number(local?.updatedAt || 0);
  const localCustom = hasCustomTimerDisplayStyles(localStyles);
  const foundationCustom = hasCustomTimerDisplayStyles(foundationStyles);

  if (foundationStyles && foundationAt >= localAt && foundationCustom) {
    return foundationStyles;
  }
  if (localCustom && localStyles) {
    return localStyles;
  }
  if (foundationCustom && foundationStyles) {
    return foundationStyles;
  }
  return baseStyles;
}

function normalizeTimerDisplayStyle(input: unknown): TimerDisplayStyle {
  const v = input && typeof input === "object" ? (input as Partial<TimerDisplayStyle>) : {};
  const op = Number(v.bgOpacity);
  const scale = Number(v.scalePercent);
  const outlineWidth = Number(v.outlineWidth);
  const fontFamilyRaw = typeof v.fontFamily === "string" ? v.fontFamily.trim() : "";
  return {
    showHours: typeof v.showHours === "boolean" ? v.showHours : false,
    design: normalizeTimerDesign(v.design),
    fontFamily: normalizeTimerFontFamily(fontFamilyRaw || "mono"),
    fontColor: typeof v.fontColor === "string" ? v.fontColor : "",
    bgColor: typeof v.bgColor === "string" ? v.bgColor : "",
    borderColor: typeof v.borderColor === "string" ? v.borderColor : "",
    outlineColor: typeof v.outlineColor === "string" ? v.outlineColor : "",
    outlineWidth: Number.isFinite(outlineWidth) ? Math.max(0, Math.min(3, Number(outlineWidth.toFixed(1)))) : 0.8,
    bgOpacity: Number.isFinite(op) ? Math.max(0, Math.min(100, Math.round(op))) : 40,
    scalePercent: Number.isFinite(scale) ? Math.max(50, Math.min(250, Math.round(scale))) : 100,
  };
}

function normalizeTimerDisplayStyles(input: unknown): AppState["timerDisplayStyles"] {
  const v = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  return {
    general: normalizeTimerDisplayStyle(v.general),
  };
}

export function parseAmount(input: string | number): number {
  if (typeof input === "number") return Math.max(0, Math.floor(input));
  const extracted = (input || "")
    .replace(/[^\d]/g, "");
  const n = parseInt(extracted || "0", 10);
  return isNaN(n) ? 0 : n;
}

/** 서버/로컬 JSON 손상 시 `donors`가 객체·숫자 등으로 오면 관리자 표 렌더가 전부 중단됨 → 항상 배열로 복구 */
export function normalizeDonorsArray(input: unknown): Donor[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((x): x is Record<string, unknown> => Boolean(x && typeof x === "object"))
    .map((x) => {
      const idRaw = String(x.id ?? "").trim();
      const targetRaw = x.target;
      const target: DonorTarget | undefined =
        targetRaw === "toon" ? "toon" : targetRaw === "account" ? "account" : undefined;
      const row: Donor = {
        id: idRaw || `d_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: normalizeAnonymousDonorDisplayName(
          typeof x.name === "string" ? x.name : String(x.name ?? "")
        ),
        amount: Math.max(0, Math.floor(Number(x.amount) || 0)),
        memberId: String(x.memberId ?? ""),
        at: Number.isFinite(Number(x.at)) ? Math.floor(Number(x.at)) : Date.now(),
      };
      if (target) row.target = target;
      const message = typeof x.message === "string" ? x.message.trim() : "";
      if (message) row.message = message;
      if (x.memberAutoAssigned === true) row.memberAutoAssigned = true;
      if (x.groupSplit === true) row.groupSplit = true;
      if (x.groupSplitSource === true) row.groupSplitSource = true;
      if (x.donationExcluded === true) row.donationExcluded = true;
      if (
        x.hsTerritoryExcluded === true ||
        !isDonationAmountEligibleForHighSocietyTerritory(row.amount)
      ) {
        row.hsTerritoryExcluded = true;
      } else if (x.hsTerritoryExcluded === false) {
        row.hsTerritoryExcluded = false;
      }
      const hsPush =
        x.hsPushDir === "left" || x.hsPushDir === "right" || x.hsPushDir === "split"
          ? x.hsPushDir
          : null;
      if (hsPush) row.hsPushDir = hsPush;
      const contributionPoints = Math.round(Number(x.contributionPoints));
      if (Number.isFinite(contributionPoints) && contributionPoints >= 0) {
        row.contributionPoints = contributionPoints;
      }
      return row;
    });
}

// ex) "3.5" => 35,000 (3만5천원), "2" => 20,000, "2.0" => 20,000
// Only first decimal digit is used as thousands; other characters are ignored.
export function parseTenThousandThousand(input: string | number): number {
  if (typeof input === "number") {
    const intPart = Math.trunc(input);
    const frac = Math.abs(input - intPart);
    const thousandDigit = Math.trunc(frac * 10);
    const value = intPart * 10000 + thousandDigit * 1000;
    return Math.max(0, value);
  }
  const s = (input || "").toString().trim();
  const match = s.replace(/,/g, "").match(/(-?\d+)(?:[.,](\d))?/);
  if (!match) return 0;
  const intPart = parseInt(match[1] || "0", 10);
  const thousandDigit = parseInt(match[2] || "0", 10);
  if (isNaN(intPart) || intPart < 0) return 0;
  const td = isNaN(thousandDigit) || thousandDigit < 0 ? 0 : thousandDigit;
  return intPart * 10000 + td * 1000;
}

export function maskTenThousandThousandInput(input: string): string {
  const s = (input || "").toString().replace(/,/g, "").replace(/[^\d.,]/g, "");
  const m = s.match(/^(\d*)([.,]?)(\d?)/);
  if (!m) return "";
  const i = m[1] || "";
  const sep = m[2] ? "." : "";
  const d = m[3] || "";
  return i + sep + d;
}

export function roundToThousand(n: number): number {
  return Math.round((n || 0) / 1000) * 1000;
}

export function loadState(userId?: string | null): AppState {
  if (typeof window === "undefined") return defaultState();
  try {
    const raw = isServerAuthoritativeBroadcastState()
      ? (() => {
          const cached = readSessionBroadcastState(userId);
          return cached ? JSON.stringify(cached) : null;
        })()
      : window.localStorage.getItem(storageKey(userId));
    if (!raw) return defaultState();
    const data = JSON.parse(raw) as AppState;
    data.members = (() => { const v = ensureMembers(data.members); return v.length > 0 ? v : defaultMembers().map(normalizeMember); })();
    data.memberPositions = normalizeMemberPositions((data as AppState).memberPositions, data.members);
    data.memberPositionMode = normalizeMemberPositionMode((data as AppState).memberPositionMode);
    data.rankPositionLabels = fitRankPositionLabelsToMemberCount(
      (data as AppState).rankPositionLabels,
      data.members.length
    );
    data.donorRankingsTheme = normalizeDonorRankingsTheme((data as AppState).donorRankingsTheme);
    data.donorRankingsFullTheme = normalizeDonorRankingsFullTheme((data as AppState).donorRankingsFullTheme);
    data.donorRankingsPresets = normalizeDonorRankingsPresets((data as AppState).donorRankingsPresets);
    data.donorRankingsPresetId = typeof (data as AppState).donorRankingsPresetId === "string" && (data as AppState).donorRankingsPresetId
      ? (data as AppState).donorRankingsPresetId
      : undefined;
    data.donors = normalizeDonorsArray(data.donors);
    data.donorsFormat = normalizeDonorsFormat((data as AppState).donorsFormat);
    data.contributionFormula = normalizeContributionFormula((data as AppState).contributionFormula);
    data.contributionLogs = Array.isArray((data as AppState).contributionLogs)
      ? ((data as AppState).contributionLogs as ContributionLog[])
          .filter((x) => x && typeof x === "object")
          .map((x) => ({
            id: String((x as ContributionLog).id || `cl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`),
            memberId: String((x as ContributionLog).memberId || ""),
            amount: Math.max(0, Math.floor(Number((x as ContributionLog).amount || 0))),
            delta: (x as ContributionLog).delta === -1 ? -1 : 1,
            note: typeof (x as ContributionLog).note === "string" ? (x as ContributionLog).note : "",
            at: Number.isFinite(Number((x as ContributionLog).at)) ? Math.floor(Number((x as ContributionLog).at)) : Date.now(),
          }))
      : [];
    data.restroomLogs = Array.isArray((data as AppState).restroomLogs)
      ? ((data as AppState).restroomLogs as RestroomLog[])
          .filter((x) => x && typeof x === "object")
          .map((x) => ({
            id: String((x as RestroomLog).id || `rl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`),
            memberId: String((x as RestroomLog).memberId || ""),
            amount: Math.max(0, Math.floor(Number((x as RestroomLog).amount || 0))),
            delta: (x as RestroomLog).delta === -1 ? -1 : 1,
            note: typeof (x as RestroomLog).note === "string" ? (x as RestroomLog).note : "",
            at: Number.isFinite(Number((x as RestroomLog).at)) ? Math.floor(Number((x as RestroomLog).at)) : Date.now(),
          }))
      : [];
    data.territoryLogs = normalizeTerritoryLogs((data as AppState).territoryLogs);
    data.forbiddenWords = data.forbiddenWords || [];
    data.missions = ensureMissionItems(data.missions);
    data.sigInventory = normalizeSigInventory((data as AppState).sigInventory);
    data.sigSoldOutStampUrl = normalizeSigImageUrlStored((data as AppState).sigSoldOutStampUrl);
    data.sigSalesMemberPresets =
      (data as AppState).sigSalesMemberPresets && typeof (data as AppState).sigSalesMemberPresets === "object"
        ? Object.fromEntries(
            Object.entries((data as AppState).sigSalesMemberPresets as Record<string, unknown>)
              .map(([memberId, ids]) => [
                memberId,
                Array.isArray(ids) ? ids.map((x) => String(x)).filter(Boolean) : [],
              ])
          )
        : {};
    data.sigSalesExcludedIds = normalizeSigSalesExcludedIds((data as AppState).sigSalesExcludedIds);
    data.donationSyncMode =
      (data as AppState).donationSyncMode === "none" ||
      (data as AppState).donationSyncMode === "mealBattle" ||
      (data as AppState).donationSyncMode === "sigMatch" ||
      (data as AppState).donationSyncMode === "sigSales" ||
      (data as AppState).donationSyncMode === "highSociety"
        ? (data as AppState).donationSyncMode
        : "mealBattle";
    data.sigMatch = data.sigMatch && typeof data.sigMatch === "object" ? data.sigMatch : {};
    data.mealBattle = normalizeMealBattle((data as AppState).mealBattle);
    data.mealMatch = data.mealMatch && typeof data.mealMatch === "object" ? data.mealMatch : {};
    const validSigMemberIds = new Set(
      data.members
        .filter(
          (m: Member) =>
            !Boolean(m.operating) &&
            !/운영비/i.test(String(m.name || "")) &&
            !/운영비/i.test(String((data.memberPositions as Record<string, string> | undefined)?.[m.id] || ""))
        )
        .map((m: Member) => m.id)
    );
    data.sigMatchSettings = {
      isActive: Boolean(data.sigMatchSettings?.isActive),
      targetCount: Number.isFinite(data.sigMatchSettings?.targetCount)
        ? Math.max(1, Math.floor(data.sigMatchSettings!.targetCount))
        : 100,
      title: typeof data.sigMatchSettings?.title === "string" && data.sigMatchSettings.title.trim()
        ? data.sigMatchSettings.title
        : "시그 대전",
      keyword: typeof data.sigMatchSettings?.keyword === "string" ? data.sigMatchSettings.keyword : "시그",
      signatureAmounts: Array.isArray(data.sigMatchSettings?.signatureAmounts)
        ? data.sigMatchSettings.signatureAmounts
            .map((x: unknown) => Number(x))
            .filter((x: number) => Number.isFinite(x) && x > 0)
        : [77, 100, 333],
      scoringMode: data.sigMatchSettings?.scoringMode === "amount" ? "amount" : "count",
      countAllDonations: (() => {
        const raw = (data as AppState).sigMatchSettings?.countAllDonations;
        if (typeof raw === "boolean") return raw;
        return data.sigMatchSettings?.scoringMode === "amount";
      })(),
      incentivePerPoint: Number.isFinite(data.sigMatchSettings?.incentivePerPoint)
        ? Math.max(0, Math.floor(data.sigMatchSettings!.incentivePerPoint))
        : 1000,
      manualAddStep: (() => {
        const raw = (data as AppState).sigMatchSettings?.manualAddStep;
        if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return undefined;
        return Math.floor(raw);
      })(),
      manualDeductStep: (() => {
        const raw = (data as AppState).sigMatchSettings?.manualDeductStep;
        if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return undefined;
        return Math.floor(raw);
      })(),
      sigMatchPools: normalizeSigMatchPools(data.sigMatchSettings?.sigMatchPools, validSigMemberIds),
      participantMemberIds: normalizeSigMatchParticipantIds(
        (data as AppState).sigMatchSettings?.participantMemberIds,
        validSigMemberIds
      ),
      donationLinks: normalizeSigMatchDonationLinks(
        (data as AppState).sigMatchSettings?.donationLinks,
        validSigMemberIds
      ),
      overlayTimerDurationSec: Number.isFinite((data as AppState).sigMatchSettings?.overlayTimerDurationSec)
        ? Math.max(0, Math.min(24 * 60 * 60, Math.floor((data as AppState).sigMatchSettings!.overlayTimerDurationSec as number)))
        : 180,
      overlayTimerEndAt: Number.isFinite((data as AppState).sigMatchSettings?.overlayTimerEndAt)
        ? Math.max(0, Math.floor(Number((data as AppState).sigMatchSettings!.overlayTimerEndAt)))
        : null,
      rulesText:
        typeof (data as AppState).sigMatchSettings?.rulesText === "string"
          ? String((data as AppState).sigMatchSettings!.rulesText).trim()
          : "",
      rulesFontSize: (() => {
        const n = Number((data as AppState).sigMatchSettings?.rulesFontSize);
        if (!Number.isFinite(n)) return 16;
        return Math.max(10, Math.min(36, Math.round(n)));
      })(),
      donationTableOptions: normalizeDonationTableColumnsOptions(
        (data as AppState).sigMatchSettings?.donationTableOptions
      ),
      vsDesign: normalizeVsDesign((data as AppState).sigMatchSettings?.vsDesign),
    };
    data.rouletteState = normalizeRouletteState((data as AppState).rouletteState);
    data.mealMatchSettings = normalizeMealMatchSettings((data as AppState).mealMatchSettings);
    data.highSocietySettings = normalizeHighSocietySettings(
      (data as AppState).highSocietySettings
    );
    {
      const hsValidIds = new Set(
        resolveHighSocietySeatMembers(
          data.members || [],
          data.highSocietySettings
        ).map((m) => m.id)
      );
      data.highSocietySettings = {
        ...data.highSocietySettings,
        donationLinks: normalizeHighSocietyDonationLinks(
          data.highSocietySettings?.donationLinks,
          hsValidIds
        ),
      };
    }
    data.generalTimer = normalizeTimerState((data as AppState).generalTimer);
    data.matchTimer = normalizeTimerState(
      (data as AppState).matchTimer ?? (data as AppState).generalTimer
    );
    data.matchTimerEnabled = normalizeMatchTimerEnabled((data as AppState).matchTimerEnabled);
    data.timerDisplayStyles = normalizeTimerDisplayStyles((data as AppState).timerDisplayStyles);
    data.donorRankingsOverlayConfig = normalizeDonorRankingsOverlayConfig((data as AppState).donorRankingsOverlayConfig);
    data.donorRankingsFullOverlayConfig = normalizeDonorRankingsOverlayConfig(
      (data as AppState).donorRankingsFullOverlayConfig
    );
    data.donationListsOverlayConfig = normalizeDonationListsOverlayConfig((data as AppState).donationListsOverlayConfig);
    data.sigRolling = normalizeSigRolling((data as AppState).sigRolling);
    data.sigRollingMeta = normalizeSigRollingMeta((data as AppState).sigRollingMeta);
    data.overlayPresets = normalizeOverlayPresetsMedia(
      Array.isArray(data.overlayPresets)
        ? data.overlayPresets
        : Array.isArray(data.overlaySettings?.presets)
          ? data.overlaySettings?.presets
          : []
    );
    return syncBattleStateWithMembers(data);
  } catch {
    return defaultState();
  }
}

/** 세션 만료 시 관리자·정산 화면에서만 로그인 유도(오버레이 등 다른 경로에서는 무시) */
function notifyAdminSessionExpired() {
  if (typeof window === "undefined") return;
  const p = window.location.pathname;
  if (!p.startsWith("/admin") && !p.startsWith("/settlements")) return;
  window.dispatchEvent(new CustomEvent("broadcast-session-expired"));
}

/** 관리자 POST — 세션 쿠키만 사용. `?user=` 를 같이 보내면 쿠키 id 와 어긋날 때 403(user_mismatch) */
async function postAppStateJson(json: string): Promise<Response> {
  return fetch("/api/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: json,
    credentials: "include",
  });
}

async function postAppStateWithAuthRecovery(json: string): Promise<Response> {
  let res = await postAppStateJson(json);
  if (res.status === 401) {
    notifyAdminSessionExpired();
    return res;
  }
  if (res.status === 403) {
    try {
      const body = (await res.clone().json()) as { error?: string };
      if (body.error === "user_mismatch" || body.error === "login_required") {
        notifyAdminSessionExpired();
      }
    } catch {
      notifyAdminSessionExpired();
    }
  }
  return res;
}

/**
 * 동시에 수백 개의 POST가 쌓이면 Chrome이 `net::ERR_INSUFFICIENT_RESOURCES`를 낸다.
 * `/api/state` 저장은 한 번에 하나만 진행하고, 진행 중 추가 요청은 최신 페이로드로 합친다.
 * SSE(`/api/events`)는 POST 성공 후 비동기로 **경량** 페이로드만 전송한다(`state_updated` + updatedAt).
 */
export type SaveStateAsyncOptions = {
  /** 후원 삭제·전체 비우기 — mergeDonorsForMultiTabSave 되살림 방지 */
  donorsAuthoritative?: boolean;
  /**
   * 삭제·단체짠 나누기처럼 클라이언트가 만든 donors 목록을 서버에 그대로 반영.
   * (donorsAuthoritative 만으로는 shrink 가 아닐 때 union 되어 제외 플래그·분배 행이 깨질 수 있음)
   */
  donorsReplace?: boolean;
  /** 정산 리셋 — placeholder member LS 복원·후원 merge 되살림 방지 */
  settlementReset?: boolean;
  /**
   * 멤버 추가·삭제·로스터 교체 — placeholder(멤버1)여도 API에 members 를 보내고
   * 서버·LS 가드가 옛 실멤버를 되살리지 않게 함.
   */
  membersAuthoritative?: boolean;
  /**
   * 시그/테마/오버레이 등 — API 본문에서 members/donors 를 빼 서버 후원을 건드리지 않음.
   * 관리자 persistState 는 기본적으로 이 플래그를 켠다(includeDonationFields 미지정 시).
   */
  omitDonationFields?: boolean;
  /**
   * 시그 대전 후원 연동 등 — API 본문에서 highSocietySettings 를 빼
   * 서버 상류사회 영토 설정을 건드리지 않음.
   */
  omitHighSocietyFields?: boolean;
  /** 판매완료 도장을 기본 도장으로 되돌릴 때만 true — 빈 URL 우연 덮어쓰기 방지 */
  clearSigSoldOutStamp?: boolean;
  /** 시그 목록 전체 삭제·기본 초기화 — 서버 사고방지 축소 차단을 우회 */
  clearSigInventory?: boolean;
  /**
   * 상류사회 OFF·일시정지·좌석 등 — API 에 highSocietySettings(+updatedAt) 만 보내
   * members/donors 가 0원으로 서버 후원·엑셀표를 덮지 않게 함.
   */
  highSocietySettingsOnly?: boolean;
};

export type SaveStateAsyncResult = {
  ok: boolean;
  serverUpdatedAt?: number;
  donorRankingsUpdatedAt?: number;
  /** Redis 저장 실패 후 서버 메모리만 기록된 경우 — 다른 PC·인스턴스에서는 보이지 않음 */
  storageFallback?: boolean;
  /** POST /api/state HTTP 상태 — 401·403 이면 재시도 루프 중단용 */
  httpStatus?: number;
};

type ServerSaveJob = {
  apiBodyJson: string;
  userId: string | null | undefined;
  ssePayload: unknown;
  resolveAll: Array<(result: SaveStateAsyncResult) => void>;
};

let serverSaveInFlight = false;
let serverSavePending: ServerSaveJob | null = null;

/** 대기 중 POST 본문을 최신 요청과 병합 — 프리셋-only PATCH가 전체 저장(후원순위 테마 등)을 덮어쓰지 않게 함 */
/** 저장 큐 병합 — 정산 리셋 직후 follow-up 이 구 at 후원을 전량 버리지 않게 rebump 후 filter */
export function mergeServerSaveApiBodies(prevJson: string, nextJson: string): string {
  try {
    const prev = JSON.parse(prevJson) as Record<string, unknown>;
    const next = JSON.parse(nextJson) as Record<string, unknown>;
    if (!prev || typeof prev !== "object" || !next || typeof next !== "object") return nextJson;
    if (next.settlementReset === true) return nextJson;
    /**
     * 정산 리셋 POST가 큐에 있는 동안 이어진 저장이 settlementReset 플래그·빈 후원을
     * 덮어 구 후원을 되살리지 않게 함. 리셋 이후 신규 후원만 남긴다.
     */
    if (prev.settlementReset === true && next.settlementReset !== true) {
      const resetAt = Math.max(
        Number(prev.settlementResetAt || 0),
        Number(next.settlementResetAt || 0)
      );
      const mergedReset: Record<string, unknown> = { ...prev, ...next };
      delete mergedReset.settlementReset;
      if (resetAt > 0) mergedReset.settlementResetAt = resetAt;
      if (Array.isArray(next.donors)) {
        mergedReset.donors =
          resetAt > 0
            ? filterDonorsAfterSettlementReset(
                rebumpDonorsPastSettlementReset(next.donors as Donor[], resetAt),
                resetAt
              )
            : next.donors;
      } else if (Array.isArray(prev.donors)) {
        mergedReset.donors = prev.donors;
      }
      if (!Array.isArray(next.members) && Array.isArray(prev.members)) {
        mergedReset.members = prev.members;
      }
      return JSON.stringify(mergedReset);
    }
    const merged: Record<string, unknown> = { ...prev, ...next };
    const prevDonors = Array.isArray(prev.donors) ? (prev.donors as Donor[]) : null;
    const nextDonors = Array.isArray(next.donors) ? (next.donors as Donor[]) : null;
    const prevAuthoritative = prev.donorsAuthoritative === true;
    const nextAuthoritative = next.donorsAuthoritative === true;
    const nextReplace = next.donorsReplace === true;
    /**
     * 수동 합산·투네 등 donorsAuthoritative 저장이 큐에서 합쳐질 때
     * 나중 POST 가 앞선 후원 목록을 통째로 덮지 않게 union 한다.
     * (의도적 삭제·단체짠 나누기·전체 비우기만 replace)
     */
    if (
      prevDonors &&
      nextDonors &&
      (prevAuthoritative || nextAuthoritative) &&
      next.settlementReset !== true
    ) {
      const intentionalShrink = isIntentionalDonorListShrink(
        nextDonors,
        prevDonors,
        Number(next.updatedAt || 0),
        Number(prev.updatedAt || 0)
      );
      if (nextReplace && nextAuthoritative) {
        merged.donors = nextDonors;
        merged.donorsAuthoritative = true;
        merged.donorsReplace = true;
      } else if (intentionalShrink && nextAuthoritative) {
        merged.donors = nextDonors;
        merged.donorsAuthoritative = true;
      } else {
        merged.donors = mergeDonorsForMultiTabSave(nextDonors, prevDonors, {
          incomingUpdatedAt: Number(next.updatedAt || 0),
          existingUpdatedAt: Number(prev.updatedAt || 0),
        });
        if (prevAuthoritative || nextAuthoritative) {
          merged.donorsAuthoritative = true;
        }
      }
    } else if (!nextAuthoritative && next.settlementReset !== true && nextDonors) {
      /**
       * 시각-only PATCH(후원 키 없음) 뒤에 빈 donors 전체 저장이 붙으면
       * 서버가 후원을 지울 수 있어, 비권한 빈/축소 donors 는 병합본에서 제거한다.
       */
      if (!prevDonors && nextDonors.length === 0) {
        delete merged.donors;
      } else if (prevDonors && nextDonors.length === 0 && prevDonors.length > 0) {
        merged.donors = prevDonors;
      } else if (prevDonors && nextDonors.length < prevDonors.length) {
        merged.donors = mergeDonorsForMultiTabSave(nextDonors, prevDonors, {
          incomingUpdatedAt: Number(next.updatedAt || 0),
          existingUpdatedAt: Number(prev.updatedAt || 0),
        });
      }
    }
    /**
     * 테마 PATCH가 플레이스홀더(멤버1…)만 실어 prev(멤버 없는 시각 저장)와 합쳐질 때
     * members 를 빼 서버 실로스터를 유지한다.
     * 금액 0인 실멤버(추가만 하고 후원 전)는 절대 제거하지 않음 — 새로고침 유실 원인.
     */
    if (
      !nextAuthoritative &&
      next.membersAuthoritative !== true &&
      next.settlementReset !== true &&
      Array.isArray(next.members) &&
      !("members" in prev) &&
      isDefaultPlaceholderMemberList(next.members as Member[])
    ) {
      delete merged.members;
    }
    /**
     * 멤버 추가·삭제(membersAuthoritative)가 큐에서 테마 PATCH와 합쳐질 때
     * 뒤쪽 저장이 옛 로스터·플래그 없이 덮지 않게 한다.
     * 슬림 로스터 POST 가 대형 테마 body 와 합쳐져도 membersAuthoritative 는 유지.
     */
    {
      const prevMembersAuth = prev.membersAuthoritative === true;
      const nextMembersAuth = next.membersAuthoritative === true;
      if (prevMembersAuth || nextMembersAuth) {
        merged.membersAuthoritative = true;
        const prevMembers = Array.isArray(prev.members) ? (prev.members as Member[]) : null;
        const nextMembers = Array.isArray(next.members) ? (next.members as Member[]) : null;
        if (prevMembersAuth && !nextMembersAuth && prevMembers) {
          merged.members = prevMembers;
          if (prev.memberPositions !== undefined) merged.memberPositions = prev.memberPositions;
          if (prev.rankPositionLabels !== undefined) merged.rankPositionLabels = prev.rankPositionLabels;
          if (prev.membersRosterUpdatedAt !== undefined) {
            merged.membersRosterUpdatedAt = prev.membersRosterUpdatedAt;
          }
        } else if (nextMembersAuth && !prevMembersAuth && nextMembers) {
          merged.members = nextMembers;
          if (next.memberPositions !== undefined) merged.memberPositions = next.memberPositions;
          if (next.rankPositionLabels !== undefined) merged.rankPositionLabels = next.rankPositionLabels;
          if (next.membersRosterUpdatedAt !== undefined) {
            merged.membersRosterUpdatedAt = next.membersRosterUpdatedAt;
          }
        } else if (prevMembers && nextMembers) {
          merged.members = pickMemberRosterPreferNewer(
            { members: nextMembers, updatedAt: Number(next.updatedAt || 0) },
            { members: prevMembers, updatedAt: Number(prev.updatedAt || 0) }
          );
          const preferNext = Number(next.updatedAt || 0) >= Number(prev.updatedAt || 0);
          const src = preferNext ? next : prev;
          if (src.memberPositions !== undefined) merged.memberPositions = src.memberPositions;
          if (src.rankPositionLabels !== undefined) merged.rankPositionLabels = src.rankPositionLabels;
          if (src.membersRosterUpdatedAt !== undefined) {
            merged.membersRosterUpdatedAt = src.membersRosterUpdatedAt;
          }
        }
      }
    }
    /** overlaySettings 는 얕은 병합으로 키가 날아가지 않게 */
    if (
      prev.overlaySettings &&
      typeof prev.overlaySettings === "object" &&
      next.overlaySettings &&
      typeof next.overlaySettings === "object"
    ) {
      merged.overlaySettings = {
        ...(prev.overlaySettings as Record<string, unknown>),
        ...(next.overlaySettings as Record<string, unknown>),
      };
    }
    const prevTheme = prev.donorRankingsTheme;
    const nextTheme = next.donorRankingsTheme;
    if (
      prevTheme &&
      typeof prevTheme === "object" &&
      nextTheme &&
      typeof nextTheme === "object" &&
      isDefaultLikeDonorRankingsTheme(nextTheme as DonorRankingsTheme) &&
      !isDefaultLikeDonorRankingsTheme(prevTheme as DonorRankingsTheme)
    ) {
      merged.donorRankingsTheme = prevTheme;
    }
    const prevFullTheme = prev.donorRankingsFullTheme;
    const nextFullTheme = next.donorRankingsFullTheme;
    if (
      prevFullTheme &&
      typeof prevFullTheme === "object" &&
      nextFullTheme &&
      typeof nextFullTheme === "object" &&
      isDefaultLikeDonorRankingsTheme(nextFullTheme as DonorRankingsTheme, DEFAULT_DONOR_RANKINGS_FULL_THEME) &&
      !isDefaultLikeDonorRankingsTheme(prevFullTheme as DonorRankingsTheme, DEFAULT_DONOR_RANKINGS_FULL_THEME)
    ) {
      merged.donorRankingsFullTheme = prevFullTheme;
    }
    if (
      Array.isArray(prev.overlayPresets) &&
      prev.overlayPresets.length > 0 &&
      Array.isArray(next.overlayPresets) &&
      isDefaultLikeOverlayPresets(next.overlayPresets) &&
      !isDefaultLikeOverlayPresets(prev.overlayPresets)
    ) {
      merged.overlayPresets = prev.overlayPresets;
    }
    const prevTimerStyles = prev.timerDisplayStyles as AppState["timerDisplayStyles"] | undefined;
    const nextTimerStyles = next.timerDisplayStyles as AppState["timerDisplayStyles"] | undefined;
    if (
      hasCustomTimerDisplayStyles(prevTimerStyles) &&
      (!nextTimerStyles || isDefaultLikeTimerDisplayStyle(nextTimerStyles.general))
    ) {
      if (nextTimerStyles?.general && prevTimerStyles?.general) {
        merged.timerDisplayStyles = {
          ...prevTimerStyles,
          general: {
            ...prevTimerStyles.general,
            ...(nextTimerStyles.general.design !== undefined
              ? { design: normalizeTimerDesign(nextTimerStyles.general.design) }
              : {}),
            ...(nextTimerStyles.general.outlineWidth !== undefined
              ? { outlineWidth: nextTimerStyles.general.outlineWidth }
              : {}),
            ...(nextTimerStyles.general.outlineColor !== undefined
              ? { outlineColor: nextTimerStyles.general.outlineColor }
              : {}),
            ...(nextTimerStyles.general.showHours !== undefined
              ? { showHours: nextTimerStyles.general.showHours }
              : {}),
            ...(nextTimerStyles.general.fontFamily !== undefined
              ? { fontFamily: nextTimerStyles.general.fontFamily }
              : {}),
            ...(nextTimerStyles.general.scalePercent !== undefined
              ? { scalePercent: nextTimerStyles.general.scalePercent }
              : {}),
          },
        };
      } else {
        merged.timerDisplayStyles = prevTimerStyles;
      }
    } else if (
      !("timerDisplayStyles" in next) &&
      hasCustomTimerDisplayStyles(prevTimerStyles)
    ) {
      merged.timerDisplayStyles = prevTimerStyles;
    }
    {
      const prevHs = prev.highSocietySettings as AppState["highSocietySettings"] | undefined;
      const nextHs = next.highSocietySettings as AppState["highSocietySettings"] | undefined;
      if (prevHs && nextHs && shouldBlockHighSocietyRegression(prevHs, nextHs)) {
        merged.highSocietySettings = prevHs;
      } else if (!("highSocietySettings" in next) && prevHs) {
        merged.highSocietySettings = prevHs;
      }
    }
    /** 판매완료 도장 — 뒤쪽 PATCH가 빈 값·키 생략으로 앞선 업로드 저장을 지우지 않게 */
    {
      const prevStamp = String(prev.sigSoldOutStampUrl || "").trim();
      const nextStamp = String(next.sigSoldOutStampUrl || "").trim();
      const clearing = next.clearSigSoldOutStamp === true;
      if (prevStamp && !clearing && !nextStamp) {
        merged.sigSoldOutStampUrl = prev.sigSoldOutStampUrl;
      }
    }
    /** 시그 전체 삭제 플래그 — 큐 병합 시 유실되지 않게 */
    if (prev.clearSigInventory === true || next.clearSigInventory === true) {
      merged.clearSigInventory = true;
    }
    return JSON.stringify(merged);
  } catch {
    return nextJson;
  }
}

/** 저장 큐가 바쁠 때 멤버 heal 재푸시 등을 건너뛰기 위함 */
export function isServerSaveBusy(): boolean {
  return serverSaveInFlight || serverSavePending != null;
}

function enqueueServerSave(
  apiBodyJson: string,
  userId: string | null | undefined,
  ssePayload: unknown
): Promise<SaveStateAsyncResult> {
  return new Promise((resolve) => {
    if (!serverSavePending) {
      serverSavePending = { apiBodyJson, userId, ssePayload, resolveAll: [resolve] };
    } else {
      serverSavePending.apiBodyJson = mergeServerSaveApiBodies(
        serverSavePending.apiBodyJson,
        apiBodyJson
      );
      serverSavePending.userId = userId;
      /** ssePayload 도 병합해 미리보기/로컬 힌트가 최신 필드를 유지 */
      if (
        serverSavePending.ssePayload &&
        typeof serverSavePending.ssePayload === "object" &&
        ssePayload &&
        typeof ssePayload === "object"
      ) {
        const prevPl = serverSavePending.ssePayload as Record<string, unknown>;
        const nextPl = ssePayload as Record<string, unknown>;
        const mergedPl: Record<string, unknown> = { ...prevPl, ...nextPl };
        const prevDonors = Array.isArray(prevPl.donors) ? (prevPl.donors as Donor[]) : null;
        const nextDonors = Array.isArray(nextPl.donors) ? (nextPl.donors as Donor[]) : null;
        if (prevDonors && prevDonors.length > 0 && (!nextDonors || nextDonors.length === 0)) {
          mergedPl.donors = prevDonors;
        } else if (prevDonors && nextDonors && nextDonors.length < prevDonors.length) {
          mergedPl.donors = mergeDonorsForMultiTabSave(nextDonors, prevDonors, {
            incomingUpdatedAt: Number(nextPl.updatedAt || 0),
            existingUpdatedAt: Number(prevPl.updatedAt || 0),
          });
        }
        serverSavePending.ssePayload = mergedPl;
      } else {
        serverSavePending.ssePayload = ssePayload;
      }
      serverSavePending.resolveAll.push(resolve);
    }
    void runServerSaveQueue();
  });
}

async function runServerSaveQueue(): Promise<void> {
  if (serverSaveInFlight || !serverSavePending) return;
  serverSaveInFlight = true;
  const job = serverSavePending;
  serverSavePending = null;
  try {
    const res = await postAppStateWithAuthRecovery(job.apiBodyJson);
    const ok = res.ok;
    const httpStatus = res.status;
    let serverUpdatedAt: number | undefined;
    let serverDonorRankingsUpdatedAt: number | undefined;
    let storageFallback = false;
    if (ok) {
      try {
        const raw = await res.text();
        const parsed = raw.trim()
          ? (JSON.parse(raw) as { updatedAt?: unknown; donorRankingsUpdatedAt?: unknown; fallback?: unknown })
          : null;
        const u = parsed?.updatedAt;
        if (typeof u === "number" && Number.isFinite(u)) serverUpdatedAt = u;
        const dr = parsed?.donorRankingsUpdatedAt;
        if (typeof dr === "number" && Number.isFinite(dr)) serverDonorRankingsUpdatedAt = dr;
        if (parsed?.fallback === "memory") storageFallback = true;
      } catch {
        /* ignore malformed body */
      }
      try {
        const { sendSSEUpdate } = require("./sse-post") as { sendSSEUpdate: (d: unknown) => Promise<void> };
        const pl = job.ssePayload as { updatedAt?: number; donorRankingsUpdatedAt?: number } | null;
        const updatedAt =
          typeof serverUpdatedAt === "number" && Number.isFinite(serverUpdatedAt)
            ? serverUpdatedAt
            : typeof pl?.updatedAt === "number" && Number.isFinite(pl.updatedAt)
              ? pl.updatedAt
              : Date.now();
        const donorRankingsUpdatedAt =
          typeof serverDonorRankingsUpdatedAt === "number" && Number.isFinite(serverDonorRankingsUpdatedAt)
            ? serverDonorRankingsUpdatedAt
            : typeof pl?.donorRankingsUpdatedAt === "number" && Number.isFinite(pl.donorRankingsUpdatedAt)
              ? pl.donorRankingsUpdatedAt
              : undefined;
        const obsTextRevision =
          pl && typeof pl === "object" && "overlaySettings" in (pl as object)
            ? revisionForStatePick(pl as AppState, STATE_PICK_OBS_TEXT)
            : 0;
        let membersRosterUpdated = false;
        let timerDisplayStylesUpdated = false;
        let generalTimerUpdated = false;
        try {
          const body = JSON.parse(job.apiBodyJson) as {
            membersAuthoritative?: boolean;
            members?: unknown;
            timerDisplayStyles?: unknown;
            generalTimer?: unknown;
            matchTimer?: unknown;
          };
          /** 테마·시그 PATCH 에 members 가 실려도 OBS forceFull 폭주 방지 — 추가·삭제 권위만 */
          membersRosterUpdated = body.membersAuthoritative === true;
          timerDisplayStylesUpdated =
            body.timerDisplayStyles != null && typeof body.timerDisplayStyles === "object";
          generalTimerUpdated =
            (body.generalTimer != null && typeof body.generalTimer === "object") ||
            (body.matchTimer != null && typeof body.matchTimer === "object");
        } catch {
          /* ignore */
        }
        void sendSSEUpdate({
          type: "state_updated",
          updatedAt,
          ...(typeof (pl as { settlementResetAt?: number } | null)?.settlementResetAt === "number"
            ? { settlementResetAt: (pl as { settlementResetAt?: number }).settlementResetAt }
            : {}),
          ...(typeof donorRankingsUpdatedAt === "number" && donorRankingsUpdatedAt > 0
            ? { donorRankingsUpdatedAt }
            : {}),
          ...(obsTextRevision > 0 ? { obsTextRevision } : {}),
          /** OBS·오버레이가 멤버 추가/삭제를 디바운스 GET이 아니라 즉시 forceFull 하도록 */
          ...(membersRosterUpdated ? { membersRosterUpdatedAt: updatedAt } : {}),
          /** 타이머 색·투명도 슬라이더 — OBS 즉시 반영 */
          ...(timerDisplayStylesUpdated ? { timerDisplayStylesUpdatedAt: updatedAt } : {}),
          /** 일반·대전 타이머 일시정지/재개 — OBS 즉시 동기화 */
          ...(generalTimerUpdated ? { generalTimerUpdatedAt: updatedAt } : {}),
        }).catch(() => {});
      } catch {
        /* ignore */
      }
    }
    for (const fn of job.resolveAll)
      fn({ ok, serverUpdatedAt, donorRankingsUpdatedAt: serverDonorRankingsUpdatedAt, storageFallback, httpStatus });
  } catch {
    for (const fn of job.resolveAll) fn({ ok: false });
  } finally {
    serverSaveInFlight = false;
    if (serverSavePending) void runServerSaveQueue();
  }
}

/** placeholder 멤버를 API에 실어내면 Redis 실멤버를 덮을 수 있어 필드 자체를 생략한다.
 * membersAuthoritative / settlementReset 이면 의도적 로스터 교체이므로 생략하지 않음. */
function omitPlaceholderMembersFromApiPayload(
  payload: Partial<AppState> & {
    donorsAuthoritative?: boolean;
    donorsReplace?: boolean;
    settlementReset?: boolean;
    membersAuthoritative?: boolean;
  }
): Partial<AppState> & {
  donorsAuthoritative?: boolean;
  donorsReplace?: boolean;
  settlementReset?: boolean;
  membersAuthoritative?: boolean;
} {
  if (payload.membersAuthoritative === true || payload.settlementReset === true) {
    return payload;
  }
  if (!isDefaultPlaceholderMemberList(payload.members as Member[] | undefined)) {
    return payload;
  }
  const {
    members: _m,
    memberPositions: _mp,
    memberPositionMode: _mpm,
    rankPositionLabels: _rpl,
    ...rest
  } = payload;
  return rest;
}

/** 관리자 /api/state 저장 시 — 스핀 결과·historyLogs는 서버 전용(POST 생략으로 대역폭 절감) */
export function appStatePayloadForApi(
  next: AppState,
  userId?: string | null,
  options?: SaveStateAsyncOptions
): Partial<AppState> & {
  donorsAuthoritative?: boolean;
  donorsReplace?: boolean;
  settlementReset?: boolean;
  membersAuthoritative?: boolean;
} {
  const normalizedSigInventory = slimSigInventoryForWire(
    normalizeSigInventory(next.sigInventory),
    userId ?? undefined
  );
  const normalizedSigRolling = normalizeSigRolling(next.sigRolling);
  const { rouletteState, ...rest } = {
    ...next,
    sigInventory: normalizedSigInventory,
    sigRolling: normalizedSigRolling,
  };
  const donors = Array.isArray(next.donors) ? next.donors : rest.donors;
  const donorRankingsUpdatedAt = next.donorRankingsUpdatedAt;
  const base: Partial<AppState> & {
    donorsAuthoritative?: boolean;
    donorsReplace?: boolean;
    settlementReset?: boolean;
    membersAuthoritative?: boolean;
  } = {
    ...rest,
    donors,
    ...(typeof donorRankingsUpdatedAt === "number" && Number.isFinite(donorRankingsUpdatedAt)
      ? { donorRankingsUpdatedAt }
      : {}),
  };
  const flags = {
    ...(options?.donorsAuthoritative ? { donorsAuthoritative: true as const } : {}),
    ...(options?.donorsReplace ? { donorsReplace: true as const } : {}),
    ...(options?.settlementReset ? { settlementReset: true as const } : {}),
    ...(options?.membersAuthoritative ? { membersAuthoritative: true as const } : {}),
  };
  let payload = omitPlaceholderMembersFromApiPayload({ ...base, ...flags });
  /** 상류사회 설정-only — 후원·멤버 금액 필드를 API 에 실지 않음 (OFF·일시정지 회귀 방지) */
  if (
    options?.highSocietySettingsOnly &&
    !options?.settlementReset &&
    !options?.donorsAuthoritative &&
    !options?.membersAuthoritative
  ) {
    return {
      updatedAt: next.updatedAt,
      highSocietySettings: next.highSocietySettings,
      ...(next.donationSyncMode ? { donationSyncMode: next.donationSyncMode } : {}),
      /** 영토만 초기화 시 [] 전달 — 키 없으면 서버가 기존 기록부 유지 */
      ...(Array.isArray(next.territoryLogs) ? { territoryLogs: next.territoryLogs } : {}),
    };
  }
  /**
   * 멤버 추가·삭제 권위: 시그 인벤·프리셋 등 대형 필드를 빼고 로스터(+참가 슬롯)만 전송.
   * 전체 POST 가 저장 큐·서버 연결을 막던 회귀 방지.
   */
  if (
    options?.membersAuthoritative &&
    options?.omitDonationFields &&
    !options?.settlementReset &&
    !options?.donorsAuthoritative
  ) {
    const rosterAt =
      typeof next.membersRosterUpdatedAt === "number" && Number.isFinite(next.membersRosterUpdatedAt)
        ? next.membersRosterUpdatedAt
        : next.updatedAt;
    return {
      updatedAt: next.updatedAt,
      members: next.members,
      memberPositions: next.memberPositions,
      memberPositionMode: next.memberPositionMode,
      rankPositionLabels: next.rankPositionLabels,
      membersRosterUpdatedAt: rosterAt,
      membersAuthoritative: true as const,
      sigMatch: next.sigMatch,
      mealMatch: next.mealMatch,
      mealBattle: next.mealBattle,
      mealMatchSettings: next.mealMatchSettings,
      sigMatchSettings: next.sigMatchSettings,
    };
  }
  /** 시그/테마/자동 저장 — 후원 금액은 API에서 제거. 실멤버명은 OBS 반영을 위해 유지 */
  if (options?.omitDonationFields && !options?.settlementReset && !options?.donorsAuthoritative) {
    const {
      donors: _d,
      members: _m,
      memberPositions: _mp,
      memberPositionMode: _mpm,
      rankPositionLabels: _rpl,
      settlementResetAt: _sra,
      ...restSafe
    } = payload;
    const keepMemberIdentity =
      options?.membersAuthoritative === true ||
      (Array.isArray(_m) &&
        !isDefaultPlaceholderMemberList(_m as Member[]) &&
        (_m as Member[]).length > 0);
    payload = keepMemberIdentity
      ? {
          ...restSafe,
          members: _m,
          ...(_mp !== undefined ? { memberPositions: _mp } : {}),
          ...(_mpm !== undefined ? { memberPositionMode: _mpm } : {}),
          ...(_rpl !== undefined ? { rankPositionLabels: _rpl } : {}),
          ...(options?.membersAuthoritative ? { membersAuthoritative: true as const } : {}),
        }
      : restSafe;
  }
  if (options?.omitHighSocietyFields && !options?.settlementReset) {
    const { highSocietySettings: _hs, ...restWithoutHs } = payload;
    payload = restWithoutHs;
  }
  /** 빈 판매완료 도장 URL은 실수로 커스텀을 지우지 않게 생략(「기본 도장」만 clear 플래그) */
  if (
    !options?.clearSigSoldOutStamp &&
    !options?.settlementReset &&
    !String(payload.sigSoldOutStampUrl || "").trim()
  ) {
    const { sigSoldOutStampUrl: _stamp, ...restWithoutStamp } = payload;
    payload = restWithoutStamp;
  }
  if (options?.clearSigSoldOutStamp) {
    payload = {
      ...payload,
      sigSoldOutStampUrl: "",
      clearSigSoldOutStamp: true,
    } as typeof payload & { clearSigSoldOutStamp: boolean };
  }
  if (options?.clearSigInventory) {
    payload = {
      ...payload,
      clearSigInventory: true,
    } as typeof payload & { clearSigInventory: boolean };
  }
  if (!rouletteState) {
    return payload;
  }
  return {
    ...payload,
    rouletteState: {
      menuCount: rouletteState.menuCount,
      menuFillFromAllActive: rouletteState.menuFillFromAllActive,
      overlayOpacity: rouletteState.overlayOpacity,
      sigResultScalePct: rouletteState.sigResultScalePct,
      overlayReloadNonce: rouletteState.overlayReloadNonce,
    },
  } as Partial<AppState> & { donorsAuthoritative?: boolean; settlementReset?: boolean };
}

/** LS에 실멤버가 있을 때 placeholder 로 덮지 않음 (의도적 로스터 교체 제외) */
function preserveLocalMeaningfulRoster(
  next: AppState,
  userId?: string | null,
  opts?: { membersAuthoritative?: boolean; settlementReset?: boolean }
): AppState {
  if (typeof window === "undefined") return next;
  if (opts?.membersAuthoritative || opts?.settlementReset) return next;
  if (hasMeaningfulMemberRoster(next)) return next;
  const existing = loadState(userId);
  if (!existing || !hasMeaningfulMemberRoster(existing)) return next;
  return {
    ...next,
    members: existing.members,
    memberPositions: existing.memberPositions,
    memberPositionMode: existing.memberPositionMode,
    rankPositionLabels: existing.rankPositionLabels,
  };
}

function normalizeStateForPersistence(state: AppState): AppState {
  const stripped = sanitizeAppStateWheelDemo(state);
  return {
    ...stripped,
    donorsFormat: normalizeDonorsFormat(stripped.donorsFormat),
    contributionFormula: normalizeContributionFormula(stripped.contributionFormula),
    sigInventory: normalizeSigInventory(stripped.sigInventory),
    sigRolling: normalizeSigRolling(stripped.sigRolling),
    sigSoldOutStampUrl: normalizeSigImageUrlStored(stripped.sigSoldOutStampUrl),
    donationListsOverlayConfig: normalizeDonationListsOverlayConfig(stripped.donationListsOverlayConfig),
    donorRankingsOverlayConfig: normalizeDonorRankingsOverlayConfig(stripped.donorRankingsOverlayConfig),
    donorRankingsFullOverlayConfig: normalizeDonorRankingsOverlayConfig(stripped.donorRankingsFullOverlayConfig),
    overlayPresets: normalizeOverlayPresetsMedia(stripped.overlayPresets),
  };
}

export function saveState(state: AppState, userId?: string | null) {
  if (typeof window === "undefined") return;
  try {
    const next = preserveLocalMeaningfulRoster(
      normalizeStateForPersistence(syncBattleStateWithMembers({ ...state, updatedAt: Date.now() })),
      userId
    );
    /** 오버레이 iframe이 서버 응답 전에 읽도록 세션 캐시 즉시 반영(LS 기록 없음) */
    writeBroadcastStateSnapshot(next, userId);
    notifyBroadcastStateLocalUpdated(userId, next.updatedAt);
    /**
     * 서버 정본 모드: 옵션 없는 전체 POST 금지 — donors/금액을 브라우저 스냅샷으로 덮지 않음.
     * (상류사회 팝업 영토 반영 등에서 엑셀·후원순위 초기화 회귀 방지)
     */
    const apiOpts = clampBrowserPersistOptionsForServerAuthority({
      omitDonationFields: true,
    });
    void enqueueServerSave(JSON.stringify(appStatePayloadForApi(next, userId, apiOpts)), userId, next)
      .then((result) => {
        if (result.ok) {
          writeBroadcastStateSnapshot(next, userId);
        }
      })
      .catch(() => {});
  } catch {
    // ignore
  }
}

export async function saveStateAsync(
  state: AppState,
  userId?: string | null,
  options?: SaveStateAsyncOptions
): Promise<SaveStateAsyncResult> {
  if (typeof window === "undefined") return { ok: false };
  options = clampBrowserPersistOptionsForServerAuthority(options) as SaveStateAsyncOptions | undefined;
  const normalized = normalizeStateForPersistence(
    syncBattleStateWithMembers({ ...state, updatedAt: Date.now() })
  );
  const next =
    options?.settlementReset || options?.membersAuthoritative
      ? normalized
      : preserveLocalMeaningfulRoster(normalized, userId, options);
  let saveOpts: SaveStateAsyncOptions | undefined = options?.settlementReset
    ? { ...options, donorsAuthoritative: true, settlementReset: true }
    : options;
  let guarded = next;
  const local = loadState(userId);
  if (
    saveOpts?.donorsAuthoritative &&
    !saveOpts?.settlementReset &&
    !saveOpts?.donorsReplace &&
    local &&
    isDonorListMemberReassignment(normalizeDonorsArray(guarded.donors), normalizeDonorsArray(local.donors))
  ) {
    saveOpts = { ...saveOpts, donorsReplace: true };
  }
  if (
    saveOpts?.donorsAuthoritative &&
    !saveOpts?.settlementReset &&
    !saveOpts?.donorsReplace &&
    isGroupSplitDonorListMutation(normalizeDonorsArray(guarded.donors))
  ) {
    saveOpts = { ...saveOpts, donorsReplace: true };
  }
  guarded =
    saveOpts?.settlementReset
      ? syncMemberTotalsFromDonors(guarded)
      : saveOpts?.membersAuthoritative
        ? (() => {
            /**
             * 멤버 추가·삭제 권위 저장: donors 가 React에 비어 있어도 LS donors 로 합산을 맞춘다.
             * donors 가 통째로 없으면 sync 로 금액을 0 초기화하지 않고 base 금액을 유지한다.
             */
            const localDonors = normalizeDonorsArray(local?.donors);
            const nextDonors = normalizeDonorsArray(guarded.donors);
            let withDonors = guarded;
            if (nextDonors.length === 0 && localDonors.length > 0) {
              withDonors = { ...guarded, donors: localDonors };
            }
            if (normalizeDonorsArray(withDonors.donors).length > 0) {
              const synced = syncMemberTotalsFromDonors(withDonors);
              const guardedSync = guardMemberTotalsAgainstAccidentalZeroWipe(synced, local ?? withDonors);
              /**
               * 로스터 id·순서는 이번 저장(guarded)이 정본 — LS/세션은 겹치는 멤버 금액만 보강.
               * (삭제 후 stale 긴 로스터를 base 로 쓰면 안 되고, merge 는 patch 쪽 id 집합을 따름)
               */
              if (local?.members?.length) {
                return {
                  ...guardedSync,
                  members: mergeMemberRosterPreservingAmounts(local.members, guardedSync.members),
                };
              }
              return guardedSync;
            }
            if (local?.members?.length) {
              return {
                ...withDonors,
                members: mergeMemberRosterPreservingAmounts(local.members, withDonors.members),
              };
            }
            return withDonors;
          })()
        : repairMemberTotalsForDonorRoster(guarded, local);
  /**
   * donorsAuthoritative 라도 정산 리셋이 아니면, LS보다 후원이 줄어든 채 올리면
   * 미매칭 반영 등으로 엑셀표가 초기화된다.
   * (삭제는 markAuthoritativeDonationSave 가 먼저 LS를 줄인 뒤 호출하므로 shrink 가 아님)
   */
  if (saveOpts?.donorsAuthoritative && !saveOpts?.settlementReset && local) {
    const localDonors = normalizeDonorsArray(local.donors);
    const nextDonors = normalizeDonorsArray(guarded.donors);
    const skipShrinkUnion =
      Boolean(saveOpts?.donorsReplace) || isGroupSplitDonorListMutation(nextDonors);
    if (
      !skipShrinkUnion &&
      localDonors.length > 0 &&
      (nextDonors.length < localDonors.length || wouldShrinkDonationData(local, guarded))
    ) {
      const localIds = new Set(localDonors.map((d) => String(d.id || "")));
      const nextIds = nextDonors.map((d) => String(d.id || ""));
      const isSubsetDelete =
        nextIds.every((id) => !id || localIds.has(id)) &&
        Number(guarded.updatedAt || 0) >= Number(local.updatedAt || 0);
      /** 수동 삭제(부분 축소)는 union 하지 않음 — 삭제분이 되살아나 엑셀이 꼬임 */
      if (!isSubsetDelete) {
        const unioned = mergeDonorsForMultiTabSave(nextDonors, localDonors, {
          incomingUpdatedAt: guarded.updatedAt,
          existingUpdatedAt: local.updatedAt,
        });
        if (unioned.length > nextDonors.length) {
          guarded = syncMemberTotalsFromDonors({ ...guarded, donors: unioned });
        }
      }
    }
  }
  if (!saveOpts?.settlementReset && !saveOpts?.donorsAuthoritative) {
    const localDonors = normalizeDonorsArray(local?.donors);
    if (localDonors.length > 0) {
      const mergedDonors = mergeDonorsForMultiTabSave(normalizeDonorsArray(guarded.donors), localDonors, {
        incomingUpdatedAt: guarded.updatedAt,
        existingUpdatedAt: local?.updatedAt,
      });
      if (mergedDonors.length !== normalizeDonorsArray(guarded.donors).length) {
        guarded = syncMemberTotalsFromDonors({ ...guarded, donors: mergedDonors });
      }
    }
    /**
     * 테마·자동저장·stale React 가 실후원을 덮지 않게 LS 금액을 유지.
     * 단, 저장본(settlementResetAt)이 LS보다 최신 리셋이면 구 LS 후원을 되살리지 않음(다른 브라우저 리셋).
     */
    const guardedResetAt = Number(guarded.settlementResetAt || 0);
    const localResetAt = Number(local?.settlementResetAt || 0);
    const sessionDonationEmpty = isEmptyBroadcastDonationSession(local);
    if (
      local &&
      !saveOpts?.membersAuthoritative &&
      !sessionDonationEmpty &&
      guardedResetAt <= localResetAt &&
      (shouldAvoidOverwritingLocalStateWithRemote(local, guarded) || wouldShrinkDonationData(local, guarded))
    ) {
      guarded = {
        ...guarded,
        members: local.members,
        donors: normalizeDonorsArray(local.donors),
        memberPositions: local.memberPositions ?? guarded.memberPositions,
        settlementResetAt: local.settlementResetAt ?? guarded.settlementResetAt,
      };
      if (normalizeDonorsArray(guarded.donors).length > 0) {
        guarded = syncMemberTotalsFromDonors(guarded);
      }
    }
    /** 시그/테마 전용 저장 — LS에도 후원 필드는 기존·더 풍부한 쪽 유지 */
    if (saveOpts?.omitDonationFields && local) {
      const nextDonors = normalizeDonorsArray(guarded.donors);
      const localDonorsForOmit = normalizeDonorsArray(local.donors);
      const preferLocalDonations =
        !saveOpts?.membersAuthoritative &&
        guardedResetAt <= localResetAt &&
        (wouldShrinkDonationData(local, guarded) ||
          localDonorsForOmit.length > nextDonors.length ||
          totalCombined(local) > totalCombined(guarded));
      guarded = {
        ...guarded,
        members: preferLocalDonations ? local.members : guarded.members,
        donors: preferLocalDonations ? localDonorsForOmit : nextDonors,
        memberPositions: preferLocalDonations
          ? local.memberPositions ?? guarded.memberPositions
          : guarded.memberPositions ?? local.memberPositions,
        settlementResetAt:
          Math.max(guardedResetAt, localResetAt) ||
          local.settlementResetAt ||
          guarded.settlementResetAt,
      };
    }
    /** 시그 후원 연동 등 — LS 상류사회 설정이 구/React 기본값으로 줄지 않게 */
    if (
      local?.highSocietySettings &&
      (saveOpts?.omitHighSocietyFields || saveOpts?.omitDonationFields) &&
      shouldBlockHighSocietyRegression(local.highSocietySettings, guarded.highSocietySettings)
    ) {
      guarded = { ...guarded, highSocietySettings: local.highSocietySettings };
    }
  }
  /**
   * 명시적 정산 리셋이 아니면 settlementResetAt 을 올리지 않음.
   * (잘못된 stamp 상승 → filterDonorsAfterSettlementReset 로 후원 전량 탈락 방지)
   */
  if (!saveOpts?.settlementReset) {
    const localReset = Number(local?.settlementResetAt || 0);
    const guardedReset = Number(guarded.settlementResetAt || 0);
    if (guardedReset > localReset) {
      guarded = {
        ...guarded,
        settlementResetAt: localReset > 0 ? localReset : undefined,
      };
    }
  }
  /**
   * donorsAuthoritative 저장만 리셋 이전 at 를 rebump·filter 한다.
   * 테마 등 비권한 저장에서 filter 후 LS setItem 하면 수동 입력이 0으로 초기화된다.
   * (서버 POST 는 route 에서 별도 filter)
   */
  {
    const resetAt = Math.max(
      Number(guarded.settlementResetAt || 0),
      Number(local?.settlementResetAt || 0)
    );
    if (resetAt > 0 && !saveOpts?.settlementReset && saveOpts?.donorsAuthoritative) {
      const before = normalizeDonorsArray(guarded.donors);
      const rebumped = rebumpDonorsPastSettlementReset(before, resetAt);
      const after = applySettlementResetDonorPipeline(before, resetAt);
      const atChanged = rebumped.some((d, i) => Number(d.at) !== Number(before[i]?.at));
      if (
        after.length !== before.length ||
        atChanged ||
        Number(guarded.settlementResetAt || 0) < resetAt
      ) {
        guarded = syncMemberTotalsFromDonors({
          ...guarded,
          donors: after,
          settlementResetAt: resetAt,
        });
      }
    }
  }
  if (local && !saveOpts?.settlementReset) {
    if (
      isDefaultLikeOverlayPresets(guarded.overlayPresets) &&
      !isDefaultLikeOverlayPresets(local.overlayPresets)
    ) {
      guarded = { ...guarded, overlayPresets: local.overlayPresets };
    }
    if (
      isDefaultLikeDonorRankingsTheme(guarded.donorRankingsTheme) &&
      !isDefaultLikeDonorRankingsTheme(local.donorRankingsTheme)
    ) {
      guarded = { ...guarded, donorRankingsTheme: local.donorRankingsTheme };
    }
    if (
      isDefaultLikeDonorRankingsTheme(guarded.donorRankingsFullTheme, DEFAULT_DONOR_RANKINGS_FULL_THEME) &&
      !isDefaultLikeDonorRankingsTheme(local.donorRankingsFullTheme, DEFAULT_DONOR_RANKINGS_FULL_THEME)
    ) {
      guarded = { ...guarded, donorRankingsFullTheme: local.donorRankingsFullTheme };
    }
    if (
      hasCustomTimerDisplayStyles(local.timerDisplayStyles) &&
      isDefaultLikeTimerDisplayStyle(guarded.timerDisplayStyles?.general)
    ) {
      guarded = { ...guarded, timerDisplayStyles: local.timerDisplayStyles };
    }
  }
  /** 명시 리셋 없이 LS 대비 남은 멤버 금액만 0으로 sync 되면 복구 */
  if (local && !saveOpts?.settlementReset) {
    guarded = guardMemberTotalsAgainstAccidentalZeroWipe(guarded, local);
  }
  /** 멤버 삭제 — donorsReplace 가 불완전하면 서버 roster-shrink 에 맡기고 금액만 LS 유지 */
  if (
    local &&
    saveOpts?.membersAuthoritative &&
    saveOpts?.donorsReplace &&
    !saveOpts?.settlementReset &&
    wouldAccidentallyZeroRemainingMembers(local, guarded)
  ) {
    saveOpts = {
      ...saveOpts,
      donorsReplace: false,
      donorsAuthoritative: false,
      omitDonationFields: true,
    };
    guarded = {
      ...guarded,
      members: mergeMemberRosterPreservingAmounts(local.members, guarded.members),
    };
  }
  if (saveOpts?.membersAuthoritative) {
    const rosterAt = Number(guarded.updatedAt || Date.now());
    guarded = { ...guarded, membersRosterUpdatedAt: rosterAt };
  }
  /** 후원이 여전히 비거나 줄어든 채 전체 POST 되면 API에서 후원 필드 제외 (서버 기존값 유지) */
  const omitDonations =
    Boolean(saveOpts?.omitDonationFields) ||
    (!saveOpts?.settlementReset &&
      !saveOpts?.donorsAuthoritative &&
      local != null &&
      wouldShrinkDonationData(local, guarded));
  const apiOpts: SaveStateAsyncOptions = {
    ...saveOpts,
    ...(omitDonations ? { omitDonationFields: true } : {}),
  };
  if (!apiOpts.omitHighSocietyFields && shouldSyncHighSocietyMemberWidthSnapshot(guarded.highSocietySettings)) {
    guarded = syncHighSocietyMemberWidthSnapshotInState(guarded);
  }
  /**
   * 영토·HS·omitDonation 저장: API 본문은 후원을 안 보내도
   * 세션 스냅샷에 0원 React state 를 쓰면 엑셀·후원순위 미리보기가 즉시 초기화됨.
   * 기존 세션 후원·금액을 유지한 뒤 알림한다.
   */
  const sessionSnap =
    apiOpts?.highSocietySettingsOnly || apiOpts?.omitDonationFields
      ? mergeBroadcastSessionPreservingDonations(local, guarded)
      : guarded;
  writeBroadcastStateSnapshot(sessionSnap, userId);
  notifyBroadcastStateLocalUpdated(userId, sessionSnap.updatedAt);
  try {
    const result = await enqueueServerSave(
      JSON.stringify(appStatePayloadForApi(guarded, userId, apiOpts)),
      userId,
      sessionSnap
    );
    if (result.ok) {
      writeBroadcastStateSnapshot(sessionSnap, userId);
    }
    return result;
  } catch {
    return { ok: false };
  }
}

export type SaveOverlayPresetsPatchOptions = {
  overlaySettingsPatch?: Record<string, unknown>;
  /** React 등 최신 상태 — LS보다 실멤버면 우선 */
  foundation?: AppState | null;
};

/**
 * 테마·시각 프리셋만 저장 — members/donors 를 보내지 않아 테마 변경 시 멤버 유실을 막는다.
 */
export async function saveOverlayPresetsPatchAsync(
  overlayPresets: unknown[],
  userId?: string | null,
  options?: SaveOverlayPresetsPatchOptions | Record<string, unknown>
): Promise<SaveStateAsyncResult> {
  if (typeof window === "undefined") return { ok: false };
  const opts: SaveOverlayPresetsPatchOptions =
    options && typeof options === "object" && ("foundation" in options || "overlaySettingsPatch" in options)
      ? (options as SaveOverlayPresetsPatchOptions)
      : { overlaySettingsPatch: options as Record<string, unknown> | undefined };
  const now = Date.now();
  const local = loadState(userId);
  const foundation = opts.foundation;
  const base =
    foundation && hasMeaningfulMemberRoster(foundation)
      ? foundation
      : local && hasMeaningfulMemberRoster(local)
        ? local
        : foundation || local;
  const nextSettings = {
    ...((base.overlaySettings && typeof base.overlaySettings === "object"
      ? base.overlaySettings
      : {}) as Record<string, unknown>),
    ...(opts.overlaySettingsPatch || {}),
  };
  const existingMeaningful = local && hasMeaningfulMemberRoster(local);
  /** LS가 빈 donors여도 React foundation 후원을 덮어쓰지 않음 (1·2·3위 이펙트 저장 시 초기화 방지) */
  const foundationDonors = normalizeDonorsArray(foundation?.donors);
  const localDonors = normalizeDonorsArray(local?.donors);
  const preservedDonors =
    foundationDonors.length === 0
      ? localDonors
      : localDonors.length === 0
        ? foundationDonors
        : mergeDonorsForMultiTabSave(foundationDonors, localDonors, {
            incomingUpdatedAt: Number(foundation?.updatedAt || 0),
            existingUpdatedAt: Number(local?.updatedAt || 0),
          });
  let preservedMembers =
    foundation && hasMeaningfulMemberRoster(foundation)
      ? foundation.members
      : local && hasMeaningfulMemberRoster(local)
        ? local.members
        : base.members;
  /** 테마 PATCH용 foundation이 0원이면 LS 실금액을 유지 */
  if (local && totalCombined(local) > 0) {
    const foundationTotal = foundation ? totalCombined(foundation) : 0;
    if (foundationTotal === 0 || shouldAvoidOverwritingLocalStateWithRemote(local, {
      ...local,
      members: preservedMembers,
      donors: preservedDonors,
    })) {
      preservedMembers = local.members;
    }
  }
  const mergedLocal: AppState = normalizeStateForPersistence(
    syncBattleStateWithMembers(
      existingMeaningful
        ? {
            ...local!,
            members: preservedMembers,
            donors: preservedDonors,
            overlayPresets: overlayPresets as AppState["overlayPresets"],
            overlaySettings: {
              ...((local!.overlaySettings && typeof local!.overlaySettings === "object"
                ? local!.overlaySettings
                : {}) as Record<string, unknown>),
              ...nextSettings,
            } as AppState["overlaySettings"],
            timerDisplayStyles: resolveTimerDisplayStylesForVisualSave(foundation, local, base),
            updatedAt: now,
          }
        : {
            ...base,
            members: preservedMembers,
            donors: preservedDonors,
            overlayPresets: overlayPresets as AppState["overlayPresets"],
            overlaySettings: nextSettings as AppState["overlaySettings"],
            timerDisplayStyles: resolveTimerDisplayStylesForVisualSave(foundation, local, base),
            updatedAt: now,
          }
    )
  );
  try {
    /** placeholder 멤버로 캐시를 덮어 OBS·관리자 탭 동기화를 망가뜨리지 않음 */
    if (hasMeaningfulMemberRoster(mergedLocal) || !existingMeaningful) {
      writeBroadcastStateSnapshot(mergedLocal, userId);
    }
  } catch {}
  notifyBroadcastStateLocalUpdated(userId, mergedLocal.updatedAt);
  const patch = {
    updatedAt: now,
    overlayPresets: normalizeOverlayPresetsMedia(mergedLocal.overlayPresets),
    overlaySettings: overlaySettingsPatchWithoutObsText(mergedLocal.overlaySettings),
    ...(hasCustomTimerDisplayStyles(mergedLocal.timerDisplayStyles)
      ? { timerDisplayStyles: mergedLocal.timerDisplayStyles }
      : {}),
  };
  try {
    return await enqueueServerSave(JSON.stringify(patch), userId, mergedLocal);
  } catch {
    return { ok: false };
  }
}

/** 오버레이 시각 옵션만 — members/donors 를 API에 실지 않음(금액색 등 저장 시 후원 초기화 방지) */
export type VisualSettingsPatch = Partial<
  Pick<
    AppState,
    | "donorRankingsTheme"
    | "donorRankingsFullTheme"
    | "donorRankingsOverlayConfig"
    | "donorRankingsFullOverlayConfig"
    | "donationListsOverlayConfig"
    | "donorRankingsPresets"
    | "donorRankingsPresetId"
    | "timerDisplayStyles"
    | "sigRolling"
    | "sigRollingMeta"
    | "sigMatchSettings"
  >
>;

/**
 * 후원순위·리스트 등 시각 설정만 PATCH.
 * 전체 saveStateAsync 가 React 빈 후원 스냅샷을 올리면 누적 금액이 초기화되던 회귀 방지.
 */
export async function saveVisualSettingsPatchAsync(
  patch: VisualSettingsPatch,
  userId?: string | null,
  foundation?: AppState | null
): Promise<SaveStateAsyncResult> {
  if (typeof window === "undefined") return { ok: false };
  const now = Date.now();
  const local = loadState(userId);
  const base =
    foundation && hasMeaningfulMemberRoster(foundation)
      ? foundation
      : local && hasMeaningfulMemberRoster(local)
        ? local
        : foundation || local || defaultState();
  const localDonors = normalizeDonorsArray(local?.donors);
  const foundationDonors = normalizeDonorsArray(foundation?.donors);
  const preservedDonors =
    localDonors.length === 0
      ? foundationDonors
      : foundationDonors.length === 0
        ? localDonors
        : wouldShrinkDonationData(local, foundation)
          ? localDonors
          : foundationDonors.length >= localDonors.length
            ? foundationDonors
            : localDonors;
  let preservedMembers =
    foundation && totalCombined(foundation) > 0
      ? foundation.members
      : local && totalCombined(local) > 0
        ? local.members
        : base.members;
  if (local && totalCombined(local) > 0 && totalCombined({ ...base, members: preservedMembers }) === 0) {
    preservedMembers = local.members;
  }
  /** 시각 PATCH가 React 빈/기본 시그 목록으로 LS 실재고를 덮지 않게 */
  const preservedSigInventory = shouldPreferLocalSigInventoryOverIncoming(
    local?.sigInventory,
    base.sigInventory,
    {
      localUpdatedAt: Number(local?.updatedAt || 0),
      incomingUpdatedAt: Number(base.updatedAt || 0),
    }
  )
    ? local!.sigInventory
    : base.sigInventory;
  const mergedLocal: AppState = normalizeStateForPersistence({
    ...base,
    ...patch,
    members: preservedMembers,
    donors: preservedDonors,
    sigInventory: preservedSigInventory,
    /** 다른 시각 옵션 저장 시 타이머 커스텀 색이 기본값으로 LS에 덮이지 않게 */
    timerDisplayStyles:
      patch.timerDisplayStyles ??
      resolveTimerDisplayStylesForVisualSave(foundation, local, base),
    memberPositions: foundation?.memberPositions ?? local?.memberPositions ?? base.memberPositions,
    settlementResetAt: foundation?.settlementResetAt ?? local?.settlementResetAt ?? base.settlementResetAt,
    updatedAt: now,
  });
  writeBroadcastStateSnapshot(mergedLocal, userId);
  notifyBroadcastStateLocalUpdated(userId, now);
  const apiPatch: Record<string, unknown> = { updatedAt: now };
  for (const key of Object.keys(patch) as (keyof VisualSettingsPatch)[]) {
    if (patch[key] !== undefined) apiPatch[key] = patch[key];
  }
  try {
    return await enqueueServerSave(JSON.stringify(apiPatch), userId, mergedLocal);
  } catch {
    return { ok: false };
  }
}

/**
 * 일반 타이머만 PATCH — members/donors 를 실지 않음.
 * 타이머 만료·일시정지 시 전체 saveStateAsync 가 빈 후원 스냅샷을 올리면 누적 금액이 초기화되던 회귀 방지.
 */
export async function saveGeneralTimerPatchAsync(
  generalTimer: TimerState,
  userId?: string | null,
  extras?: {
    matchTimerEnabled?: AppState["matchTimerEnabled"];
    timerDisplayStyles?: AppState["timerDisplayStyles"];
    overlayPresets?: AppState["overlayPresets"];
  }
): Promise<SaveStateAsyncResult> {
  if (typeof window === "undefined") return { ok: false };
  const now = Date.now();
  const timer = snapshotTimerForPersist(generalTimer, now);
  const local = loadState(userId);
  const foundation = local ?? defaultState();
  const mergedLocal: AppState = normalizeStateForPersistence({
    ...foundation,
    generalTimer: timer,
    ...(extras?.matchTimerEnabled ? { matchTimerEnabled: extras.matchTimerEnabled } : {}),
    ...(extras?.timerDisplayStyles
      ? { timerDisplayStyles: extras.timerDisplayStyles }
      : {}),
    ...(extras?.overlayPresets ? { overlayPresets: extras.overlayPresets } : {}),
    updatedAt: now,
  });
  writeBroadcastStateSnapshot(mergedLocal, userId);
  notifyBroadcastStateLocalUpdated(userId, now);
  const patch: Record<string, unknown> = {
    updatedAt: now,
    generalTimer: timer,
  };
  if (extras?.matchTimerEnabled) patch.matchTimerEnabled = extras.matchTimerEnabled;
  if (extras?.timerDisplayStyles) {
    patch.timerDisplayStyles = extras.timerDisplayStyles;
    patch.timerDisplayStylesUpdatedAt = now;
  }
  if (extras?.overlayPresets) {
    patch.overlayPresets = normalizeOverlayPresetsMedia(extras.overlayPresets);
  }
  try {
    return await enqueueServerSave(JSON.stringify(patch), userId, mergedLocal);
  } catch {
    return { ok: false };
  }
}

/** 대전(시그·식사·상류사회) 타이머만 PATCH — generalTimer·후원 필드는 건드리지 않음 */
export async function saveMatchTimerPatchAsync(
  matchTimer: TimerState,
  userId?: string | null,
  extras?: {
    matchTimerEnabled?: AppState["matchTimerEnabled"];
  }
): Promise<SaveStateAsyncResult> {
  if (typeof window === "undefined") return { ok: false };
  const now = Date.now();
  const timer = snapshotTimerForPersist(matchTimer, now);
  const local = loadState(userId);
  const foundation = local ?? defaultState();
  const mergedLocal: AppState = normalizeStateForPersistence({
    ...foundation,
    matchTimer: timer,
    ...(extras?.matchTimerEnabled ? { matchTimerEnabled: extras.matchTimerEnabled } : {}),
    updatedAt: now,
  });
  writeBroadcastStateSnapshot(mergedLocal, userId);
  notifyBroadcastStateLocalUpdated(userId, now);
  const patch: Record<string, unknown> = {
    updatedAt: now,
    matchTimer: timer,
  };
  if (extras?.matchTimerEnabled) patch.matchTimerEnabled = extras.matchTimerEnabled;
  try {
    return await enqueueServerSave(JSON.stringify(patch), userId, mergedLocal);
  } catch {
    return { ok: false };
  }
}

/**
 * OBS 텍스트 오버레이만 PATCH — members·sigInventory·overlayPresets 를 건드리지 않음.
 * `userId` 필수(OBS URL `u=` 와 동일 계정).
 */
export async function saveObsTextRegistryAsync(
  registry: ObsTextOverlayRegistry,
  userId?: string | null
): Promise<SaveStateAsyncResult> {
  if (typeof window === "undefined") return { ok: false };
  const now = Date.now();
  const normalized = normalizeObsTextRegistry(registry);
  const local = loadState(userId);
  const existingOs =
    local?.overlaySettings && typeof local.overlaySettings === "object"
      ? (local.overlaySettings as Record<string, unknown>)
      : {};
  const nextOs = {
    ...existingOs,
    [OBS_TEXT_OVERLAY_STATE_KEY]: normalized,
  };
  const sseHint: AppState = {
    ...(local ?? defaultState()),
    overlaySettings: nextOs as AppState["overlaySettings"],
    updatedAt: now,
  };
  if (local) {
    const mergedLocal = normalizeStateForPersistence(
      syncBattleStateWithMembers({
        ...local,
        overlaySettings: nextOs as AppState["overlaySettings"],
        updatedAt: now,
      })
    );
    writeBroadcastStateSnapshot(mergedLocal, userId);
  }
  notifyBroadcastStateLocalUpdated(userId, now);
  const patch = {
    updatedAt: now,
    overlaySettings: { [OBS_TEXT_OVERLAY_STATE_KEY]: normalized },
  };
  try {
    return await enqueueServerSave(JSON.stringify(patch), userId, sseHint);
  } catch {
    return { ok: false };
  }
}

export type BuildSigSalesManualApiPatchOptions = {
  /** 리롤 등 — sigInventory 서버 merge 생략(회전판 재고·다른 기능 보호) */
  omitSigInventory?: boolean;
};

/** 수동 시그 리롤·판매 확정 — 재고·초안·수동 방송만 PATCH(회전판·멤버 덮어쓰기 방지) */
export function buildSigSalesManualApiPatch(
  next: AppState,
  userId?: string | null,
  options?: BuildSigSalesManualApiPatchOptions
): Partial<AppState> {
  const normalizedSigInventory = slimSigInventoryForWire(
    normalizeSigInventory(next.sigInventory),
    userId ?? undefined
  );
  const os =
    next.overlaySettings && typeof next.overlaySettings === "object"
      ? (next.overlaySettings as Record<string, unknown>)
      : {};
  const manualDraft = os[MANUAL_SIG_DRAFT_STATE_KEY];
  const manualBroadcast = os[MANUAL_SIG_BROADCAST_STATE_KEY];
  const patch: Partial<AppState> = {
    updatedAt: next.updatedAt ?? Date.now(),
    ...(options?.omitSigInventory ? {} : { sigInventory: normalizedSigInventory }),
    sigSalesExcludedIds: next.sigSalesExcludedIds,
    sigSoldOutStampUrl: next.sigSoldOutStampUrl,
    sigRollingMeta: next.sigRollingMeta,
  };
  const overlayPatch: Record<string, unknown> = {};
  if (manualDraft && typeof manualDraft === "object") {
    overlayPatch[MANUAL_SIG_DRAFT_STATE_KEY] = manualDraft;
  }
  if (manualBroadcast && typeof manualBroadcast === "object") {
    overlayPatch[MANUAL_SIG_BROADCAST_STATE_KEY] = manualBroadcast;
  }
  if (Object.keys(overlayPatch).length > 0) {
    patch.overlaySettings = overlayPatch as AppState["overlaySettings"];
  }
  return patch;
}

function obsTextRegistryMaxRevision(raw: unknown): number {
  if (!raw || typeof raw !== "object") return 0;
  try {
    const reg = normalizeObsTextRegistry(raw);
    return Math.max(0, ...reg.instances.map((inst) => Number(inst.config.revision || 0)));
  } catch {
    return 0;
  }
}

export function overlaySettingsPatchWithoutObsText(
  overlaySettings: AppState["overlaySettings"] | undefined | null
): Record<string, unknown> {
  if (!overlaySettings || typeof overlaySettings !== "object") return {};
  const os = { ...(overlaySettings as Record<string, unknown>) };
  delete os[OBS_TEXT_OVERLAY_STATE_KEY];
  return os;
}

/**
 * 수동 시그 리롤·판매 저장 — 탭에 남아 있던 stale 스냅샷이 타이틀 텍스트 오버레이를 되돌리지 않게 함.
 * (로컬에 더 최신 revision 이 있으면 유지, next 가 더 새로우면 next 채택)
 */
export function mergeOverlaySettingsPreservingObsText(
  foundationOs: Record<string, unknown>,
  nextOs: Record<string, unknown>
): AppState["overlaySettings"] {
  const merged = { ...foundationOs, ...nextOs };
  const foundationObs = foundationOs[OBS_TEXT_OVERLAY_STATE_KEY];
  const nextObs = nextOs[OBS_TEXT_OVERLAY_STATE_KEY];
  if (!foundationObs || typeof foundationObs !== "object") {
    return merged as AppState["overlaySettings"];
  }
  const foundationRev = obsTextRegistryMaxRevision(foundationObs);
  const nextRev = nextObs && typeof nextObs === "object" ? obsTextRegistryMaxRevision(nextObs) : 0;
  merged[OBS_TEXT_OVERLAY_STATE_KEY] = nextRev > foundationRev ? nextObs : foundationObs;
  return merged as AppState["overlaySettings"];
}

export function mergeSigSalesManualIntoLocalState(
  base: AppState,
  next: AppState,
  options?: BuildSigSalesManualApiPatchOptions
): AppState {
  /**
   * 로컬에 실데이터가 있으면 그 위에 수동 필드만 얹음.
   * (수동 탭의 stale `next`가 generalTimer·멤버·후원을 덮어 관리자/OBS 타이머가 리셋되던 문제 방지)
   */
  const foundation = hasMeaningfulBroadcastData(base) ? base : next;
  const baseOs =
    base.overlaySettings && typeof base.overlaySettings === "object"
      ? (base.overlaySettings as Record<string, unknown>)
      : {};
  const foundationOs =
    foundation.overlaySettings && typeof foundation.overlaySettings === "object"
      ? (foundation.overlaySettings as Record<string, unknown>)
      : {};
  const nextOs =
    next.overlaySettings && typeof next.overlaySettings === "object"
      ? (next.overlaySettings as Record<string, unknown>)
      : {};
  const manualOverlayOs = { ...foundationOs, ...nextOs };
  const nextInv = next.sigInventory ?? foundation.sigInventory;
  const baseInv = base.sigInventory;
  let sigInventory = options?.omitSigInventory
    ? foundation.sigInventory
    : nextInv;
  /** omit 시에도 LS·next 중 더 풍부한 재고를 유지(시각 저장으로 LS가 비면 리롤 후 풀이 사라지던 문제) */
  if (options?.omitSigInventory) {
    if (
      shouldPreferLocalSigInventoryOverIncoming(next.sigInventory, sigInventory, {
        localUpdatedAt: Number(next.updatedAt || 0),
        incomingUpdatedAt: Number(foundation.updatedAt || 0),
      })
    ) {
      sigInventory = next.sigInventory;
    } else if (
      shouldPreferLocalSigInventoryOverIncoming(baseInv, sigInventory, {
        localUpdatedAt: Number(base.updatedAt || 0),
        incomingUpdatedAt: Number(foundation.updatedAt || 0),
      })
    ) {
      sigInventory = baseInv;
    }
  }
  return normalizeStateForPersistence(
    syncBattleStateWithMembers({
      ...foundation,
      sigInventory,
      sigSalesExcludedIds: next.sigSalesExcludedIds ?? foundation.sigSalesExcludedIds,
      sigSoldOutStampUrl: next.sigSoldOutStampUrl ?? foundation.sigSoldOutStampUrl,
      sigRollingMeta: next.sigRollingMeta ?? foundation.sigRollingMeta,
      /** obs 텍스트는 localStorage(base) 기준 — 수동 탭 stale 스냅샷이 덮어쓰지 않음 */
      overlaySettings: mergeOverlaySettingsPreservingObsText(baseOs, manualOverlayOs),
      /** 수동 저장은 회전판 상태를 건드리지 않음 */
      rouletteState: foundation.rouletteState,
      updatedAt: Date.now(),
    })
  );
}

export async function saveSigSalesManualStateAsync(
  state: AppState,
  userId?: string | null,
  options?: BuildSigSalesManualApiPatchOptions
): Promise<SaveStateAsyncResult> {
  if (typeof window === "undefined") return { ok: false };
  const next = normalizeStateForPersistence(syncBattleStateWithMembers({ ...state, updatedAt: Date.now() }));
  const baseLocal = loadState(userId);
  const mergedLocal = mergeSigSalesManualIntoLocalState(baseLocal || next, next, options);
  writeBroadcastStateSnapshot(mergedLocal, userId);
  try {
    const patch = buildSigSalesManualApiPatch(next, userId, options);
    return await enqueueServerSave(JSON.stringify(patch), userId, mergedLocal);
  } catch {
    return { ok: false };
  }
}

const loadStateInflight = new Map<string, Promise<AppState | null>>();

let warnedMemoryStateBackend = false;

function maybeWarnMemoryStateBackend(res: Response): void {
  if (typeof window === "undefined" || warnedMemoryStateBackend) return;
  if (res.headers.get("x-broadcast-state-storage") !== "memory") return;
  const h = window.location.hostname;
  if (h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h.endsWith(".local")) return;
  warnedMemoryStateBackend = true;
  console.warn(
    "[방송 정산] 서버가 상태를 메모리에만 두고 있습니다. DATABASE_URL(MySQL) 또는 UPSTASH_REDIS_* 를 설정하거나 인스턴스를 1개로 맞추세요."
  );
}

export type LoadStateFromApiOptions = {
  /** 클라이언트가 이미 가진 `updatedAt` — 서버가 같거나 오래되면 304(본문 없음) */
  ifUpdatedSince?: number;
  /** true면 since 무시·캐시 버스터로 전체 본문 수신(OBS 새로고침·pageshow) */
  forceFull?: boolean;
  /** OBS·오버레이: 서버가 축소 JSON 반환 (`overlay` | `overlay-donors` | `sig-sales`) */
  pick?: StateApiPick;
};

export async function loadStateFromApi(
  userId?: string,
  options?: LoadStateFromApiOptions
): Promise<AppState | null> {
  /** forceFull(리롤·OBS 새로고침)은 dedupe 제외 — 동시 요청이 구 스냅샷을 공유하는 회귀 방지 */
  if (!options?.forceFull) {
    const dedupeKey = `${userId ?? "__cookie__"}:${options?.ifUpdatedSince ?? 0}:${options?.pick ?? "full"}`;
    const existing = loadStateInflight.get(dedupeKey);
    if (existing) return existing;
    const created = doLoadStateFromApi(userId, options);
    loadStateInflight.set(dedupeKey, created);
    created.finally(() => {
      if (loadStateInflight.get(dedupeKey) === created) loadStateInflight.delete(dedupeKey);
    });
    return created;
  }
  return doLoadStateFromApi(userId, options);
}

async function doLoadStateFromApi(
  userId?: string,
  options?: LoadStateFromApiOptions
): Promise<AppState | null> {
  try {
    const since = options?.forceFull ? 0 : Number(options?.ifUpdatedSince || 0);
    const q = new URLSearchParams();
    if (since > 0) q.set("since", String(Math.floor(since)));
    else q.set("_t", String(Date.now()));
    if (userId) {
      q.set("user", userId);
      /** `/api/state` 가 `u` 만 받는 프록시·구버전 호환 */
      q.set("u", userId);
    }
    if (options?.pick) q.set("pick", options.pick);
    /** `userId` 있으면 URL로 사용자 특정 → 쿠키 불필요(OBS·브라우저 소스는 쿠키 없음). 없으면 관리자 세션 쿠키로 조회 */
    const credentials = userId ? "omit" : "include";
    const signal =
      typeof AbortSignal !== "undefined" &&
      typeof (AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }).timeout === "function"
        ? (AbortSignal as unknown as { timeout: (ms: number) => AbortSignal }).timeout(12_000)
        : undefined;
    const res = await fetch(`/api/state?${q.toString()}`, { cache: "no-store", credentials, signal });
    if (res.status === 401) {
      notifyAdminSessionExpired();
      return null;
    }
    if (res.status === 304) return null;
    if (!res.ok) return null;
    maybeWarnMemoryStateBackend(res);
    const text = await res.text();
    if (!text.trim()) return null;
    let data: AppState;
    try {
      data = JSON.parse(text) as AppState;
    } catch {
      return null;
    }
    if (isDonorRankingsPickPartial(data)) {
      const base = defaultState();
      data = { ...base, ...data } as AppState;
    } else if (options?.pick === STATE_PICK_OBS_TEXT) {
      data = {
        ...defaultState(),
        updatedAt: Number(data.updatedAt || 0),
        overlaySettings:
          data.overlaySettings && typeof data.overlaySettings === "object"
            ? data.overlaySettings
            : {},
      } as AppState;
    } else if (isOverlayPickPartial(data)) {
      let base = defaultState();
      if (typeof window !== "undefined") {
        const local = loadState(userId);
        if (local && hasMeaningfulMemberRoster(local)) {
          base = local;
        } else if (
          options?.pick === STATE_PICK_SIG_SALES &&
          local &&
          hasMeaningfulBroadcastData(local)
        ) {
          base = local;
        }
      }
      const patchOs =
        data.overlaySettings && typeof data.overlaySettings === "object"
          ? data.overlaySettings
          : {};
      const baseOs =
        base.overlaySettings && typeof base.overlaySettings === "object"
          ? base.overlaySettings
          : {};
      data = {
        ...base,
        ...data,
        overlaySettings: { ...baseOs, ...patchOs },
        generalTimer: mergeGeneralTimerPreferEffective(base.generalTimer, (data as AppState).generalTimer),
        matchTimer: mergeGeneralTimerPreferEffective(
          base.matchTimer ?? base.generalTimer,
          (data as AppState).matchTimer ?? (data as AppState).generalTimer
        ),
        rouletteState: {
          ...base.rouletteState,
          ...(data.rouletteState && typeof data.rouletteState === "object" ? data.rouletteState : {}),
        },
      } as AppState;
      /** pick 응답에 멤버가 비었거나 placeholder 면 로컬 실멤버를 유지 */
      if (
        hasMeaningfulMemberRoster(base) &&
        (!Array.isArray(data.members) ||
          data.members.length === 0 ||
          isDefaultPlaceholderMemberList(data.members))
      ) {
        data.members = base.members;
        data.memberPositions = base.memberPositions;
        data.memberPositionMode = base.memberPositionMode;
        data.rankPositionLabels = base.rankPositionLabels;
      }
      /** pick 응답 donors 가 비었는데 로컬·베이스에 후원이 있으면 유지 (폴링·OBS 깜빡임·0원 초기화 방지) */
      const patchDonors = normalizeDonorsArray(data.donors);
      const baseDonors = normalizeDonorsArray(base.donors);
      if (
        baseDonors.length > 0 &&
        (patchDonors.length === 0 || wouldShrinkDonationData(base, data as AppState))
      ) {
        data.donors = baseDonors;
        if (totalCombined(data as AppState) < totalCombined(base)) {
          /** 서버(짧은) 로스터가 정본 — last-good 로 삭제 멤버를 되살리지 않고 금액만 보강 */
          data.members = mergeMemberRosterPreservingAmounts(
            base.members || [],
            (data as AppState).members || []
          );
        }
      }
    }
    if (data && data.members) {
      data.members = (() => { const v = ensureMembers(data.members); return v.length > 0 ? v : defaultMembers().map(normalizeMember); })();
      data.memberPositions = normalizeMemberPositions((data as AppState).memberPositions, data.members);
      data.memberPositionMode = normalizeMemberPositionMode((data as AppState).memberPositionMode);
      data.rankPositionLabels = fitRankPositionLabelsToMemberCount(
        (data as AppState).rankPositionLabels,
        data.members.length
      );
      data.donorRankingsTheme = normalizeDonorRankingsTheme((data as AppState).donorRankingsTheme);
      data.donorRankingsFullTheme = normalizeDonorRankingsFullTheme((data as AppState).donorRankingsFullTheme);
      data.donorRankingsPresets = normalizeDonorRankingsPresets((data as AppState).donorRankingsPresets);
      data.donorRankingsPresetId = typeof (data as AppState).donorRankingsPresetId === "string" && (data as AppState).donorRankingsPresetId
        ? (data as AppState).donorRankingsPresetId
        : undefined;
      data.donors = normalizeDonorsArray(data.donors);
      data.donorsFormat = normalizeDonorsFormat((data as AppState).donorsFormat);
      data.contributionFormula = normalizeContributionFormula((data as AppState).contributionFormula);
      /** pick/병합 후 donors 대비 members 합계가 비면 엑셀표만 0 — 여기서 맞춤 */
      if (data.donors.length > 0) {
        data = syncMemberTotalsFromDonors(data);
      }
      data.contributionLogs = Array.isArray((data as AppState).contributionLogs)
        ? ((data as AppState).contributionLogs as ContributionLog[])
            .filter((x) => x && typeof x === "object")
            .map((x) => ({
              id: String((x as ContributionLog).id || `cl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`),
              memberId: String((x as ContributionLog).memberId || ""),
              amount: Math.max(0, Math.floor(Number((x as ContributionLog).amount || 0))),
              delta: (x as ContributionLog).delta === -1 ? -1 : 1,
              note: typeof (x as ContributionLog).note === "string" ? (x as ContributionLog).note : "",
              at: Number.isFinite(Number((x as ContributionLog).at)) ? Math.floor(Number((x as ContributionLog).at)) : Date.now(),
            }))
        : [];
      data.restroomLogs = Array.isArray((data as AppState).restroomLogs)
        ? ((data as AppState).restroomLogs as RestroomLog[])
            .filter((x) => x && typeof x === "object")
            .map((x) => ({
              id: String((x as RestroomLog).id || `rl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`),
              memberId: String((x as RestroomLog).memberId || ""),
              amount: Math.max(0, Math.floor(Number((x as RestroomLog).amount || 0))),
              delta: (x as RestroomLog).delta === -1 ? -1 : 1,
              note: typeof (x as RestroomLog).note === "string" ? (x as RestroomLog).note : "",
              at: Number.isFinite(Number((x as RestroomLog).at)) ? Math.floor(Number((x as RestroomLog).at)) : Date.now(),
            }))
        : [];
      data.territoryLogs = normalizeTerritoryLogs((data as AppState).territoryLogs);
      data.forbiddenWords = data.forbiddenWords || [];
      data.missions = ensureMissionItems(data.missions);
      data.sigInventory = normalizeSigInventory((data as AppState).sigInventory);
      data.sigSoldOutStampUrl = normalizeSigImageUrlStored((data as AppState).sigSoldOutStampUrl);
      data.sigSalesMemberPresets =
        (data as AppState).sigSalesMemberPresets && typeof (data as AppState).sigSalesMemberPresets === "object"
          ? Object.fromEntries(
              Object.entries((data as AppState).sigSalesMemberPresets as Record<string, unknown>)
                .map(([memberId, ids]) => [
                  memberId,
                  Array.isArray(ids) ? ids.map((x) => String(x)).filter(Boolean) : [],
                ])
            )
          : {};
      data.sigSalesExcludedIds = normalizeSigSalesExcludedIds((data as AppState).sigSalesExcludedIds);
      data.donationSyncMode =
        (data as AppState).donationSyncMode === "none" ||
        (data as AppState).donationSyncMode === "mealBattle" ||
        (data as AppState).donationSyncMode === "sigMatch" ||
        (data as AppState).donationSyncMode === "sigSales" ||
        (data as AppState).donationSyncMode === "highSociety"
          ? (data as AppState).donationSyncMode
          : "mealBattle";
      data.sigMatch = data.sigMatch && typeof data.sigMatch === "object" ? data.sigMatch : {};
      data.mealBattle = normalizeMealBattle((data as AppState).mealBattle);
      data.mealMatch = data.mealMatch && typeof data.mealMatch === "object" ? data.mealMatch : {};
      const validSigMemberIdsApi = new Set<string>(
        (data.members as Member[])
          .filter(
            (m) =>
              !Boolean(m.operating) &&
              !/운영비/i.test(String(m.name || "")) &&
              !/운영비/i.test(String((data.memberPositions as Record<string, string> | undefined)?.[m.id] || ""))
          )
          .map((m) => m.id)
      );
      data.sigMatchSettings = {
        isActive: Boolean(data.sigMatchSettings?.isActive),
        targetCount: Number.isFinite(data.sigMatchSettings?.targetCount)
          ? Math.max(1, Math.floor(data.sigMatchSettings!.targetCount))
          : 100,
        title: typeof data.sigMatchSettings?.title === "string" && data.sigMatchSettings.title.trim()
          ? data.sigMatchSettings.title
          : "시그 대전",
        keyword: typeof data.sigMatchSettings?.keyword === "string" ? data.sigMatchSettings.keyword : "시그",
        signatureAmounts: Array.isArray(data.sigMatchSettings?.signatureAmounts)
          ? data.sigMatchSettings.signatureAmounts
              .map((x: unknown) => Number(x))
              .filter((x: number) => Number.isFinite(x) && x > 0)
          : [77, 100, 333],
        scoringMode: data.sigMatchSettings?.scoringMode === "amount" ? "amount" : "count",
        countAllDonations: (() => {
          const raw = (data as AppState).sigMatchSettings?.countAllDonations;
          if (typeof raw === "boolean") return raw;
          return data.sigMatchSettings?.scoringMode === "amount";
        })(),
        incentivePerPoint: Number.isFinite(data.sigMatchSettings?.incentivePerPoint)
          ? Math.max(0, Math.floor(data.sigMatchSettings!.incentivePerPoint))
          : 1000,
        manualAddStep: (() => {
          const raw = (data as AppState).sigMatchSettings?.manualAddStep;
          if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return undefined;
          return Math.floor(raw);
        })(),
        manualDeductStep: (() => {
          const raw = (data as AppState).sigMatchSettings?.manualDeductStep;
          if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return undefined;
          return Math.floor(raw);
        })(),
        sigMatchPools: normalizeSigMatchPools(data.sigMatchSettings?.sigMatchPools, validSigMemberIdsApi),
        participantMemberIds: normalizeSigMatchParticipantIds(
          (data as AppState).sigMatchSettings?.participantMemberIds,
          validSigMemberIdsApi
        ),
        donationLinks: normalizeSigMatchDonationLinks(
          (data as AppState).sigMatchSettings?.donationLinks,
          validSigMemberIdsApi
        ),
        overlayTimerDurationSec: Number.isFinite((data as AppState).sigMatchSettings?.overlayTimerDurationSec)
          ? Math.max(0, Math.min(24 * 60 * 60, Math.floor((data as AppState).sigMatchSettings!.overlayTimerDurationSec as number)))
          : 180,
        overlayTimerEndAt: Number.isFinite((data as AppState).sigMatchSettings?.overlayTimerEndAt)
          ? Math.max(0, Math.floor(Number((data as AppState).sigMatchSettings!.overlayTimerEndAt)))
          : null,
        rulesText:
          typeof (data as AppState).sigMatchSettings?.rulesText === "string"
            ? String((data as AppState).sigMatchSettings!.rulesText).trim()
            : "",
        rulesFontSize: (() => {
          const n = Number((data as AppState).sigMatchSettings?.rulesFontSize);
          if (!Number.isFinite(n)) return 16;
          return Math.max(10, Math.min(36, Math.round(n)));
        })(),
        donationTableOptions: normalizeDonationTableColumnsOptions(
          (data as AppState).sigMatchSettings?.donationTableOptions
        ),
        vsDesign: normalizeVsDesign((data as AppState).sigMatchSettings?.vsDesign),
      };
      data.rouletteState = normalizeRouletteState((data as AppState).rouletteState);
      data.mealMatchSettings = normalizeMealMatchSettings((data as AppState).mealMatchSettings);
    data.highSocietySettings = normalizeHighSocietySettings(
      (data as AppState).highSocietySettings
    );
    {
      const hsValidIds = new Set(
        resolveHighSocietySeatMembers(
          data.members || [],
          data.highSocietySettings
        ).map((m) => m.id)
      );
      data.highSocietySettings = {
        ...data.highSocietySettings,
        donationLinks: normalizeHighSocietyDonationLinks(
          data.highSocietySettings?.donationLinks,
          hsValidIds
        ),
      };
    }
      data.generalTimer = normalizeTimerState((data as AppState).generalTimer);
      data.matchTimer = normalizeTimerState(
        (data as AppState).matchTimer ?? (data as AppState).generalTimer
      );
      data.matchTimerEnabled = normalizeMatchTimerEnabled((data as AppState).matchTimerEnabled);
      data.timerDisplayStyles = normalizeTimerDisplayStyles((data as AppState).timerDisplayStyles);
      data.donorRankingsOverlayConfig = normalizeDonorRankingsOverlayConfig((data as AppState).donorRankingsOverlayConfig);
    data.donorRankingsFullOverlayConfig = normalizeDonorRankingsOverlayConfig(
      (data as AppState).donorRankingsFullOverlayConfig
    );
      data.donationListsOverlayConfig = normalizeDonationListsOverlayConfig((data as AppState).donationListsOverlayConfig);
      data.sigRolling = normalizeSigRolling((data as AppState).sigRolling);
      data.sigRollingMeta = normalizeSigRollingMeta((data as AppState).sigRollingMeta);
      data.overlayPresets = normalizeOverlayPresetsMedia(
        Array.isArray(data.overlayPresets)
          ? data.overlayPresets
          : Array.isArray(data.overlaySettings?.presets)
            ? data.overlaySettings?.presets
            : []
      );
      const synced = syncBattleStateWithMembers(data as AppState);
      const toPersist = preserveLocalMeaningfulRoster(synced, userId);
      if (options?.pick === STATE_PICK_OBS_TEXT) {
        return toPersist;
      }
      if (typeof window !== "undefined") {
        try {
          if (isServerAuthoritativeBroadcastState()) {
            writeBroadcastStateSnapshot(toPersist, userId);
          } else {
            const existing = loadState(userId);
            if (!shouldAvoidOverwritingLocalStateWithRemote(existing, toPersist)) {
              writeBroadcastStateSnapshot(toPersist, userId);
            }
          }
        } catch {}
      }
      return toPersist;
    }
    return null;
  } catch {
    return null;
  }
}

export type MergeDonorsForMultiTabSaveOptions = {
  incomingUpdatedAt?: number;
  existingUpdatedAt?: number;
  /** 관리자 후원 삭제 등 — 서버 병합으로 삭제분을 되살리지 않음 */
  donorsAuthoritative?: boolean;
};

/** 동일 id 집합에서 memberId·금액·메시지 등 내용 차이 */
export function donorsListContentDiffers(
  a: Donor[] | undefined,
  b: Donor[] | undefined
): boolean {
  const an = normalizeDonorsArray(a);
  const bn = normalizeDonorsArray(b);
  if (an.length !== bn.length) return true;
  const bMap = new Map(bn.map((d) => [String(d.id), d]));
  return an.some((ld) => {
    const rd = bMap.get(String(ld.id));
    if (!rd) return true;
    return (
      String(rd.memberId || "") !== String(ld.memberId || "") ||
      Math.round(Number(rd.amount) || 0) !== Math.round(Number(ld.amount) || 0) ||
      String(rd.message || "").trim() !== String(ld.message || "").trim() ||
      Boolean(rd.donationExcluded) !== Boolean(ld.donationExcluded) ||
      rd.hsTerritoryExcluded !== ld.hsTerritoryExcluded ||
      String(rd.hsPushDir || "") !== String(ld.hsPushDir || "") ||
      Boolean(rd.groupSplit) !== Boolean(ld.groupSplit) ||
      Boolean(rd.groupSplitSource) !== Boolean(ld.groupSplitSource)
    );
  });
}

/** 건수·금액 동일, memberId만 바뀐 재배치 — union 시 구 배치로 되돌아가면 안 됨 */
export function isDonorListMemberReassignment(
  incoming: Donor[] | undefined,
  existing: Donor[] | undefined
): boolean {
  const inc = normalizeDonorsArray(incoming);
  const ex = normalizeDonorsArray(existing);
  if (inc.length === 0 || inc.length !== ex.length) return false;
  const exMap = new Map(ex.map((d) => [String(d.id), d]));
  let memberChanges = 0;
  for (const d of inc) {
    const prev = exMap.get(String(d.id));
    if (!prev) return false;
    if (Math.round(Number(prev.amount) || 0) !== Math.round(Number(d.amount) || 0)) return false;
    if (String(prev.memberId || "") !== String(d.memberId || "")) memberChanges += 1;
  }
  return memberChanges > 0;
}

function unionDonorsById(existing: Donor[], incoming: Donor[]): Donor[] {
  const map = new Map<string, Donor>();
  for (const d of existing) map.set(String(d.id), d);
  for (const d of incoming) {
    const id = String(d.id);
    const prev = map.get(id);
    if (!prev) {
      map.set(id, d);
      continue;
    }
    const prevAt = donorAtEpochMs(prev);
    const nextAt = donorAtEpochMs(d);
    if (nextAt > prevAt) {
      map.set(id, mergeDonorRowFields(d, prev));
    } else if (nextAt < prevAt) {
      map.set(id, mergeDonorRowFields(prev, d));
    } else {
      map.set(id, mergeDonorRowFields(d, prev));
    }
  }
  return Array.from(map.values()).sort((a, b) => donorAtEpochMs(b) - donorAtEpochMs(a));
}

/**
 * 여러 브라우저/탭이 동시에 저장할 때 오래된 탭이 후원 목록을 덮어쓰는 것을 완화합니다.
 * - 라이브 방송: 명시적 삭제(`donorsAuthoritative`)·정산 리셋 외에는 id union — 후원 누락·자동 초기화 방지.
 * - incoming에 새 id가 있으면 기존과 병합(최신 at 우선).
 * - `incomingUpdatedAt` 이 서버보다 오래되면 삭제·추가 모두 무시(existing 유지).
 */
export function mergeDonorsForMultiTabSave(
  incoming: Donor[],
  existing: Donor[] | undefined,
  opts?: MergeDonorsForMultiTabSaveOptions
): Donor[] {
  const incomingAt = Number(opts?.incomingUpdatedAt || 0);
  const existingAt = Number(opts?.existingUpdatedAt || 0);
  const incomingStale = incomingAt > 0 && existingAt > 0 && incomingAt < existingAt;

  if (!existing || existing.length === 0) return incoming;
  if (incoming.length === 0) {
    if (opts?.donorsAuthoritative && !incomingStale) return incoming;
    return existing;
  }

  if (incomingStale) return existing;

  if (opts?.donorsAuthoritative) {
    return [...incoming].sort((a, b) => b.at - a.at);
  }

  return unionDonorsById(existing, incoming);
}

/** React·ref·LS 등 여러 소스 donors 를 id union */
export function resolveRichestDonorsFromSources(
  sources: Array<Donor[] | null | undefined>,
  opts?: { incomingUpdatedAt?: number; existingUpdatedAt?: number }
): Donor[] {
  let merged: Donor[] = [];
  for (const source of sources) {
    const norm = normalizeDonorsArray(source);
    if (norm.length === 0) continue;
    merged =
      merged.length === 0
        ? norm
        : mergeDonorsForMultiTabSave(merged, norm, {
            incomingUpdatedAt: opts?.incomingUpdatedAt ?? 0,
            existingUpdatedAt: opts?.existingUpdatedAt ?? 0,
          });
  }
  return merged;
}

/**
 * 수동 삭제처럼 incoming 이 existing 의 부분집합이고 시각이 앞설 때만 true.
 * 합산 추가(신규 id)·투네와 경합 시에는 false → 서버는 replace 대신 union.
 */
export function isIntentionalDonorListShrink(
  incoming: Donor[] | undefined,
  existing: Donor[] | undefined,
  incomingUpdatedAt = 0,
  existingUpdatedAt = 0
): boolean {
  const incomingNorm = normalizeDonorsArray(incoming);
  const existingNorm = normalizeDonorsArray(existing);
  if (existingNorm.length === 0) return false;
  if (incomingNorm.length >= existingNorm.length) return false;
  const removedCount = existingNorm.length - incomingNorm.length;
  /** 2건 이상 한 번에 줄면 UI 불완전·동기화 오류 가능 — union 유지(단건 삭제만 replace) */
  if (removedCount > 1) return false;
  const existingIds = new Set(existingNorm.map((d) => String(d.id || "")).filter(Boolean));
  const incomingIds = incomingNorm.map((d) => String(d.id || "")).filter(Boolean);
  /** 신규 id 가 있으면 합산·투네 반영 — 삭제가 아님 */
  if (incomingIds.some((id) => !existingIds.has(id))) return false;
  if (incomingIds.some((id) => !id)) return false;
  const inAt = Number(incomingUpdatedAt || 0);
  const exAt = Number(existingUpdatedAt || 0);
  if (inAt > 0 && exAt > 0 && inAt < exAt) return false;
  return true;
}

/** filterDonorsAfterSettlementReset / rebump 와 동일 grace */
const SETTLEMENT_RESET_DONOR_GRACE_MS = 3000;

function donorAtEpochMs(donor: { at?: number | string }): number {
  const raw = donor.at;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (Number.isFinite(Number(raw))) return Math.floor(Number(raw));
  const parsed = Date.parse(String(raw || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** 정산 리셋 이후 구 탭·다른 PC가 실어낸 후원(at < reset) 제거 */
export function filterDonorsAfterSettlementReset(
  donors: Donor[] | undefined,
  settlementResetAt: number
): Donor[] {
  const resetAt = Number(settlementResetAt || 0);
  if (!resetAt) return normalizeDonorsArray(donors);
  const threshold = resetAt - SETTLEMENT_RESET_DONOR_GRACE_MS;
  return normalizeDonorsArray(donors).filter((d) => {
    const at = donorAtEpochMs(d);
    if (!Number.isFinite(at) || at <= 0) return true;
    return at >= threshold;
  });
}

/**
 * 일일 로그·브라우저 복구 시 리셋 이전 at 이면 서버 저장 직후 전부 걸림.
 * 의도적 복구에서는 reset 이후로 at 을 올려 엑셀·후원순위에 반영되게 한다.
 */
export function rebumpDonorsPastSettlementReset(
  donors: Donor[] | undefined,
  settlementResetAt: number
): Donor[] {
  const resetAt = Number(settlementResetAt || 0);
  const normalized = normalizeDonorsArray(donors);
  if (!resetAt) return normalized;
  const threshold = resetAt - SETTLEMENT_RESET_DONOR_GRACE_MS;
  let seq = 0;
  return normalized.map((d) => {
    const at = donorAtEpochMs(d);
    if (!Number.isFinite(at) || at <= 0 || at >= threshold) return d;
    const bumped = resetAt + seq;
    seq += 1;
    return { ...d, at: bumped };
  });
}

/** rebump → filter. 명시 리셋이 아닐 때 필터가 전량 탈락시키면 rebump 본을 유지 */
export function applySettlementResetDonorPipeline(
  donors: Donor[] | undefined,
  settlementResetAt: number,
  opts?: { allowFullWipe?: boolean }
): Donor[] {
  const resetAt = Number(settlementResetAt || 0);
  const normalized = normalizeDonorsArray(donors);
  if (!resetAt) return normalized;
  const rebumped = rebumpDonorsPastSettlementReset(normalized, resetAt);
  const filtered = filterDonorsAfterSettlementReset(rebumped, resetAt);
  if (!opts?.allowFullWipe && normalized.length > 0 && filtered.length === 0) {
    return rebumped;
  }
  return filtered;
}

/**
 * 서버 정본 모드: UI·세션이 비었는데 서버 스냅샷에 후원이 있으면 반영.
 * 단, 로컬에 settlementResetAt 이 있고 서버 후원이 전부 리셋 이전이면
 * rebump 로 되돌리지 않음(정산 리셋 직후·새로고침 회귀 방지).
 */
export function resolveServerDonorsForEmptyLocal(opts: {
  local: AppState;
  incomingDonors: Donor[] | undefined;
  settlementResetAt?: number;
}): Donor[] | null {
  if (!isServerAuthoritativeBroadcastState()) return null;
  const localDonors = normalizeDonorsArray(opts.local.donors);
  const incomingDonors = normalizeDonorsArray(opts.incomingDonors);
  if (localDonors.length > 0 || incomingDonors.length === 0) return null;
  const localReset = Number(opts.local.settlementResetAt || 0);
  const resetAt = Math.max(Number(opts.settlementResetAt || 0), localReset);
  /** 의도적 정산 리셋(로컬 비움+stamp): 구 후원 rebump 금지 — 리셋 이후 건만 수용 */
  if (localReset > 0 && isEmptyBroadcastDonationSession(opts.local)) {
    const surviving = filterDonorsAfterSettlementReset(incomingDonors, localReset);
    return surviving.length > 0 ? surviving : null;
  }
  const restored = applySettlementResetDonorPipeline(
    rebumpDonorsPastSettlementReset(incomingDonors, resetAt),
    resetAt
  );
  return restored.length > 0 ? restored : null;
}

/** 세션·UI 후원이 비었을 때 서버(또는 union) donors 를 정산 리셋 파이프라인으로 반영 */
export function pickAuthoritativeDonorsForEmptySession(
  local: AppState,
  serverDonors: Donor[] | undefined,
  mergedDonors?: Donor[] | undefined,
  settlementResetAt?: number
): Donor[] {
  const fromServer = normalizeDonorsArray(serverDonors);
  const fromMerged = normalizeDonorsArray(mergedDonors);
  const bestIncoming = fromServer.length >= fromMerged.length ? fromServer : fromMerged;
  const localDonors = normalizeDonorsArray(local.donors);
  const localReset = Number(local.settlementResetAt || 0);
  const resetAt = Math.max(Number(settlementResetAt || 0), localReset);
  const applyPipeline = (donors: Donor[]) =>
    applySettlementResetDonorPipeline(
      rebumpDonorsPastSettlementReset(donors, resetAt),
      resetAt
    );
  /** 의도적 정산 리셋 직후 — 구 후원(at < reset) 을 rebump 해 되살리지 않음 */
  const respectLocalSettlementReset =
    localDonors.length === 0 &&
    localReset > 0 &&
    isEmptyBroadcastDonationSession(local);
  if (respectLocalSettlementReset) {
    return filterDonorsAfterSettlementReset(bestIncoming, localReset);
  }
  /** 서버(MySQL)가 UI보다 많으면 — 읽기 경로, 로컬 축소본으로 덮지 않음 */
  if (bestIncoming.length > localDonors.length) {
    return applyPipeline(bestIncoming);
  }
  if (!isEmptyBroadcastDonationSession(local)) {
    return localDonors.length > 0 ? localDonors : bestIncoming;
  }
  if (bestIncoming.length === 0) return [];
  return applyPipeline(bestIncoming);
}

/**
 * DB→UI 단방향: 서버(MySQL) donors 를 React admin 화면에 반영. POST·브라우저 저장 없음.
 * UI donor 행이 서버보다 적으면 stale member 합계와 무관하게 서버 donors 를 우선한다.
 * `forceReplace`: 화면이 서버보다 많아도(고착) 서버 donors·합계로 맞춤.
 */
export function buildUiStateFromServerDonorPull(
  local: AppState,
  remote: AppState,
  opts?: { forceReplace?: boolean }
): AppState | null {
  const remoteDonors = normalizeDonorsArray(remote.donors);
  if (remoteDonors.length === 0) return null;
  const localDonors = normalizeDonorsArray(local.donors);
  const localReset = Number(local.settlementResetAt || 0);
  /** 의도적 정산 리셋으로 비운 UI — forceReplace 로도 구 후원을 되살리지 않음 */
  if (
    localDonors.length === 0 &&
    isEmptyBroadcastDonationSession(local) &&
    (Number(local.intentionalDonationClearAt || 0) > 0 || localReset > 0)
  ) {
    const surviving = filterDonorsAfterSettlementReset(remoteDonors, localReset);
    if (surviving.length === 0) return null;
  }
  const localIds = new Set(localDonors.map((d) => String(d.id || "")));
  const remoteMissingInLocal = remoteDonors.filter((d) => !localIds.has(String(d.id || "")));
  if (
    !opts?.forceReplace &&
    localDonors.length >= remoteDonors.length &&
    localDonors.length > 0 &&
    totalCombined(local) >= totalCombined(remote) &&
    remoteMissingInLocal.length === 0
  ) {
    return null;
  }
  const resetAt = Math.max(
    Number(local.settlementResetAt || 0),
    Number(remote.settlementResetAt || 0)
  );
  let donors = opts?.forceReplace
    ? Number(local.intentionalDonationClearAt || 0) > 0 && isEmptyBroadcastDonationSession(local)
      ? filterDonorsAfterSettlementReset(remoteDonors, localReset)
      : remoteDonors
    : pickAuthoritativeDonorsForEmptySession(local, remoteDonors, remoteDonors, resetAt);
  if (donors.length === 0) {
    const localReset = Number(local.settlementResetAt || 0);
    /** 정산 리셋으로 비운 UI — 구 후원 rebump·강제 복구 금지 */
    if (
      localDonors.length === 0 &&
      localReset > 0 &&
      isEmptyBroadcastDonationSession(local)
    ) {
      return null;
    }
    donors = applySettlementResetDonorPipeline(
      rebumpDonorsPastSettlementReset(remoteDonors, resetAt),
      resetAt
    );
  }
  if (donors.length === 0) {
    /** 정산 리셋·의도적 비움 — rebump 후에도 없으면 구 후원 raw 복구 금지 */
    if (
      localDonors.length === 0 &&
      isEmptyBroadcastDonationSession(local) &&
      (Number(local.intentionalDonationClearAt || 0) > 0 ||
        Number(local.settlementResetAt || 0) > 0)
    ) {
      return null;
    }
    donors = remoteDonors;
  }
  const members = pickMemberRosterPreferNewer(local, remote);
  return syncMemberTotalsFromDonors({
    ...local,
    ...remote,
    members,
    memberPositions: normalizeMemberPositions(
      local.memberPositions ?? remote.memberPositions,
      members
    ),
    donors,
    updatedAt: Math.max(Number(remote.updatedAt || 0), Date.now()),
    donorRankingsUpdatedAt: Math.max(
      Number(local.donorRankingsUpdatedAt || 0),
      Number(remote.donorRankingsUpdatedAt || 0),
      Date.now()
    ),
  });
}

/** 세션 캐시에 후원·합계가 없음 — 서버 스냅샷을 거부하지 않을 때 */
export function isEmptyBroadcastDonationSession(state: AppState | null | undefined): boolean {
  if (!state) return true;
  return (
    normalizeDonorsArray(state.donors).length === 0 && totalCombined(state) === 0
  );
}

/**
 * 영토·HS·테마 등 비후원 저장이 세션/미리보기에 0원·빈 donors 를 뿌리지 않게
 * 기존 세션의 후원·멤버 금액을 유지한 채 패치 필드를 얹는다.
 */
export function mergeBroadcastSessionPreservingDonations(
  existing: AppState | null | undefined,
  patch: AppState
): AppState {
  if (!existing || isEmptyBroadcastDonationSession(existing)) return patch;
  if (!wouldShrinkDonationData(existing, patch) && !isEmptyBroadcastDonationSession(patch)) {
    return patch;
  }
  return {
    ...patch,
    donors: normalizeDonorsArray(existing.donors),
    members: mergeMemberRosterPreservingAmounts(existing.members || [], patch.members || []),
    memberPositions: existing.memberPositions ?? patch.memberPositions,
    settlementResetAt: existing.settlementResetAt ?? patch.settlementResetAt,
  };
}

/**
 * 정산 리셋 시각 병합.
 * - `settlementReset: true` 일 때만 새 stamp 허용 (사용자 명시 리셋).
 * - 그 외에는 서버(base) 값만 유지 — 클라이언트가 올린 더 큰 settlementResetAt 로
 *   후원이 자동 초기화되는 것을 막는다. (낮추는 것도 금지 → 리셋 가드 해제 방지)
 */
export function coalesceSettlementResetAt(opts: {
  baseResetAt?: number;
  patchResetAt?: number;
  settlementReset?: boolean;
  resetStamp?: number;
}): number {
  if (opts.settlementReset) {
    const stamp = Number(opts.resetStamp || 0);
    return stamp > 0 ? stamp : Date.now();
  }
  return Math.max(0, Number(opts.baseResetAt || 0));
}

export function totalAccount(state: AppState): number {
  return state.members.reduce((sum, m) => sum + (m.account || 0), 0);
}

export function totalToon(state: AppState): number {
  return state.members.reduce((sum, m) => sum + (m.toon || 0), 0);
}

export function totalCombined(state: AppState): number {
  return totalAccount(state) + totalToon(state);
}

/** 기본(한방 시그만) 또는 구 데모 프리셋(+한방)만 남은 축소 목록인지 */
export function isShrunkToDefaultSigInventory(inv: SigItem[] | null | undefined): boolean {
  if (!Array.isArray(inv) || inv.length === 0) return false;
  if (inv.length > DEFAULT_SIG_INVENTORY.length + 2) return false;
  const defaultIds = new Set(DEFAULT_SIG_INVENTORY.map((x) => x.id));
  return inv.every(
    (x) => defaultIds.has(String(x.id || "")) || String(x.id || "") === ONE_SHOT_SIG_ID
  );
}

/** PC 업로드·엑셀 등으로 늘어난 커스텀 시그 목록인지 */
export function hasExpandedSigInventory(inv: SigItem[] | null | undefined): boolean {
  if (!Array.isArray(inv) || inv.length === 0) return false;
  const nonOneShot = inv.filter((x) => x.id !== ONE_SHOT_SIG_ID);
  if (nonOneShot.length > DEFAULT_SIG_INVENTORY.length) return true;
  const presetNames = new Set<string>(BROADCAST_SIG_PRESET_NAMES);
  return nonOneShot.some((x) => !presetNames.has(String(x.name || "").trim()));
}

function sigInventoryNonOneShotCount(inv: SigItem[] | null | undefined): number {
  return (inv || []).filter((x) => x.id !== ONE_SHOT_SIG_ID).length;
}

/**
 * toona 가져오기·서버 동기화 등 — incoming 이 로컬보다 풍부하면 로컬 보호를 깨고 수용.
 * (보호창이 빈/구 목록을 유지해 가져오기가 UI에 안 보이던 회귀 방지)
 */
export function isRicherSigInventory(
  candidate: SigItem[] | null | undefined,
  baseline: SigItem[] | null | undefined
): boolean {
  const a = candidate || [];
  const b = baseline || [];
  const aN = sigInventoryNonOneShotCount(a);
  const bN = sigInventoryNonOneShotCount(b);
  if (aN > bN) return true;
  if (aN < bN) return false;
  if (aN === 0) return false;
  if (hasExpandedSigInventory(a) && !hasExpandedSigInventory(b)) return true;
  const aToona = a.filter((x) => String(x.id || "").startsWith("toona_")).length;
  const bToona = b.filter((x) => String(x.id || "").startsWith("toona_")).length;
  return aToona > bToona;
}

/** 멤버별 시그 판매 프리셋이 하나라도 저장돼 있는지 */
export function hasSigSalesMemberPresets(
  presets: AppState["sigSalesMemberPresets"] | null | undefined
): boolean {
  if (!presets || typeof presets !== "object") return false;
  return Object.values(presets).some((ids) => Array.isArray(ids) && ids.length > 0);
}

/**
 * 원격 GET·다른 탭 storage merge 시 로컬 시그 목록을 유지할지.
 * 서버 재시작·기본 프리셋 복귀·구버전 탭 저장으로 목록이 줄어드는 회귀를 막는다.
 */
export function shouldPreferLocalSigInventoryOverIncoming(
  localInv: SigItem[] | null | undefined,
  incomingInv: SigItem[] | null | undefined,
  opts?: { localUpdatedAt?: number; incomingUpdatedAt?: number }
): boolean {
  const local = localInv || [];
  const incoming = incomingInv || [];
  if (local.length === 0) return false;
  /** toona 가져오기·서버가 더 긴 목록이면 로컬 보호하지 않음 */
  if (isRicherSigInventory(incoming, local)) return false;
  if (hasExpandedSigInventory(local) && isShrunkToDefaultSigInventory(incoming)) {
    return true;
  }
  if (!hasExpandedSigInventory(local) || incoming.length >= local.length) {
    return false;
  }
  const localIds = new Set(local.map((x) => String(x.id)));
  if (!incoming.every((x) => localIds.has(String(x.id)))) {
    return false;
  }
  const lost = local.length - incoming.length;
  if (lost < 3 && lost / local.length < 0.15) {
    return false;
  }
  const localAt = Number(opts?.localUpdatedAt || 0);
  const incomingAt = Number(opts?.incomingUpdatedAt || 0);
  if (incomingAt > localAt + 1000) {
    return false;
  }
  return true;
}

/** 서버/동기화 시 기본값으로 덮어쓰기 방지: remote가 기본 상태처럼 보이는지 확인 */
export function isDefaultLikeState(state: AppState): boolean {
  const def = defaultMembers();
  const m = state.members || [];
  if (m.length !== def.length) return false;
  const allDefaultNames = m.every((mm, i) => mm.id === def[i].id && mm.name === def[i].name);
  const donorsSafe = normalizeDonorsArray(state.donors);
  const noData = totalCombined(state) === 0 && donorsSafe.length === 0;
  return allDefaultNames && noData;
}

/**
 * 사용자 「정산 리셋」이 아닌 사고성 빈 상태.
 * - 멤버1·2… 플레이스홀더(또는 멤버 없음) + 후원 0 + 합계 0
 * - 정상 정산 리셋은 실멤버명을 유지하므로 여기에 해당하지 않음
 */
export function isAccidentalEmptyRosterState(state: AppState | null | undefined): boolean {
  if (!state) return true;
  const members = state.members;
  if (!Array.isArray(members) || members.length === 0) {
    return normalizeDonorsArray(state.donors).length === 0 && totalCombined(state) === 0;
  }
  if (!isDefaultPlaceholderMemberList(members)) return false;
  return normalizeDonorsArray(state.donors).length === 0 && totalCombined(state) === 0;
}

/** 사고성 빈 원격이 실데이터를 stamp만으로 덮지 못하게 */
export function shouldBlockAccidentalEmptyOverwrite(
  existing: AppState | null | undefined,
  incoming: AppState | null | undefined
): boolean {
  if (!existing || !incoming) return false;
  if (!isAccidentalEmptyRosterState(incoming)) return false;
  if (isAccidentalEmptyRosterState(existing)) return false;
  /**
   * 의도적 정산 리셋 마커 — 「멤버 초기화」플레이스홀더도 사고성으로 취급하지 않음.
   * settlementResetAt 상승은 서버가 settlementReset 플래그로만 허용.
   */
  if (Number(incoming.intentionalDonationClearAt || 0) > 0) {
    return false;
  }
  if (Number(incoming.settlementResetAt || 0) > Number(existing.settlementResetAt || 0)) {
    return false;
  }
  return (
    hasMeaningfulMemberRoster(existing) ||
    normalizeDonorsArray(existing.donors).length > 0 ||
    totalCombined(existing) > 0
  );
}

/** 멤버1·멤버2… 초기 슬롯만 있고 금액·후원이 없는 목록(인원 수는 1~30) */
export function isDefaultPlaceholderMemberList(members: Member[] | null | undefined): boolean {
  if (!Array.isArray(members) || members.length === 0) return true;
  return members.every((m, i) => {
    const n = i + 1;
    const idOk = m.id === `m${n}`;
    const nameOk = !String(m.name || "").trim() || m.name === `멤버${n}`;
    return idOk && nameOk;
  });
}

/** 단일 멤버명이 초기 슬롯(멤버N) 또는 빈 이름인지 */
export function isPlaceholderMemberName(name: string | null | undefined, id?: string): boolean {
  const n = String(name || "").trim();
  if (!n) return true;
  if (/^멤버\d+$/.test(n)) return true;
  const idMatch = String(id || "").match(/^m(\d+)$/);
  if (idMatch && n === `멤버${idMatch[1]}`) return true;
  return false;
}

/**
 * 로컬에서 바꾼 실멤버명·목표·운영비를 원격 스냅샷에 얹음.
 * (관리자에서 이름만 바꾼 뒤 서버 후원 금액을 받을 때 OBS에 이름이 남도록)
 *
 * 이름 우선순위:
 * - 원격이 멤버N 플레이스홀더이고 로컬이 실명 → 로컬
 * - 둘 다 실명인데 로컬 updatedAt 이 같거나 더 최신 → 로컬(방금 관리자 개명)
 * - 그 외(OBS last-good 옛 실명 vs 서버 새 이름) → 원격 유지
 */
export function mergeLocalMemberIdentityOntoRemote(
  remote: AppState,
  local: AppState | null | undefined
): AppState {
  if (!remote || !local || !hasMeaningfulMemberRoster(local)) return remote;
  const localById = new Map((local.members || []).map((m) => [m.id, m]));
  const localNewerOrEqual =
    Number(local.updatedAt || 0) >= Number(remote.updatedAt || 0);
  let changed = false;
  const members = (remote.members || []).map((rm) => {
    const lm = localById.get(rm.id);
    if (!lm) return rm;
    const localName = String(lm.name || "").trim();
    if (!localName || isPlaceholderMemberName(localName, lm.id)) return rm;
    const remoteName = String(rm.name || "").trim();
    const nameDiff = remoteName !== localName;
    const goalDiff = lm.goal !== rm.goal;
    const opDiff = Boolean(lm.operating) !== Boolean(rm.operating);
    if (!nameDiff && !goalDiff && !opDiff) return rm;
    const preferLocalName =
      nameDiff &&
      (isPlaceholderMemberName(remoteName, rm.id) || localNewerOrEqual);
    if (!preferLocalName && !goalDiff && !opDiff) return rm;
    changed = true;
    return {
      ...rm,
      name: preferLocalName ? localName : rm.name,
      goal: lm.goal !== undefined ? lm.goal : rm.goal,
      operating: Boolean(lm.operating),
    };
  });
  if (!changed) return remote;
  return { ...remote, members };
}

export function membersDifferByIds(a: Member[], b: Member[]): boolean {
  const sig = (list: Member[]) =>
    list
      .map((m) => m.id)
      .sort()
      .join("\u001e");
  return sig(a) !== sig(b);
}

/**
 * local 로스터가 remote 의 모든 id 를 포함하고 더 김 — 멤버 추가 직후 옛 원격으로 덮이면 안 됨.
 * (placeholder 여부·stamp 와 무관하게 구조적 상위집합만 본다)
 */
export function isMemberRosterStrictSuperset(
  local: Member[] | null | undefined,
  remote: Member[] | null | undefined
): boolean {
  const localMembers = Array.isArray(local) ? local : [];
  const remoteMembers = Array.isArray(remote) ? remote : [];
  if (localMembers.length <= remoteMembers.length) return false;
  if (remoteMembers.length === 0) return localMembers.length > 0;
  const localIds = new Set(
    localMembers.map((m) => String(m.id || "").trim()).filter(Boolean)
  );
  if (localIds.size === 0) return false;
  return remoteMembers.every((m) => localIds.has(String(m.id || "").trim()));
}

/**
 * 멤버 추가·삭제 후 새로고침/병합 시 — stamp가 같거나 더 최신인 로스터를 고른다.
 * (후원 금액은 syncMemberTotalsFromDonors 가 donors 기준으로 다시 맞춘다)
 */
export function pickMemberRosterPreferNewer(
  primary: { members?: Member[] | null; updatedAt?: number } | null | undefined,
  secondary: { members?: Member[] | null; updatedAt?: number } | null | undefined
): Member[] {
  const a = Array.isArray(primary?.members) ? primary!.members! : [];
  const b = Array.isArray(secondary?.members) ? secondary!.members! : [];
  const aAt = Number(primary?.updatedAt || 0);
  const bAt = Number(secondary?.updatedAt || 0);
  /**
   * 멤버 추가분(상위집합)은 stamp가 살짝 뒤처져도 유지(테마 PATCH 경합).
   * 다만 상대 stamp가 멀리 앞서면(다른 기기 삭제) 긴 쪽을 강제하지 않음.
   */
  const SUPERSET_GRACE_MS = 120_000;
  if (isMemberRosterStrictSuperset(a, b) && (aAt >= bAt || aAt + SUPERSET_GRACE_MS >= bAt)) {
    return a;
  }
  if (isMemberRosterStrictSuperset(b, a) && (bAt >= aAt || bAt + SUPERSET_GRACE_MS >= aAt)) {
    return b;
  }
  const aState = { members: a } as AppState;
  const bState = { members: b } as AppState;
  const aOk = hasMeaningfulMemberRoster(aState);
  const bOk = hasMeaningfulMemberRoster(bState);
  if (aOk && !bOk) return a;
  if (bOk && !aOk) return b;
  if (!a.length && !b.length) return a;
  if (!aOk && !bOk) return a.length >= b.length ? a : b;
  if (!membersDifferByIds(a, b)) {
    return Number(secondary?.updatedAt || 0) > Number(primary?.updatedAt || 0) ? b : a;
  }
  return Number(primary?.updatedAt || 0) >= Number(secondary?.updatedAt || 0) ? a : b;
}

/**
 * 엑셀 표에 쓸 멤버 로스터가 실데이터인지.
 * `멤버1·2·3` 초기 슬롯이면 금액·후원이 있어도 false —
 * 테마 변경 직후 placeholder 가 last-good/미리보기 억제로 굳는 것을 막는다.
 */
export function hasMeaningfulMemberRoster(state: AppState | null | undefined): boolean {
  if (!state) return false;
  const members = state.members || [];
  if (members.length === 0) return false;
  if (isDefaultPlaceholderMemberList(members)) return false;
  return true;
}

/** 로컬에 실제 방송 데이터(커스텀 멤버·금액·후원·시그 목록)가 있는지 */
export function hasMeaningfulBroadcastData(state: AppState): boolean {
  if (hasMeaningfulMemberRoster(state)) return true;
  if (hasExpandedSigInventory(state.sigInventory)) return true;
  return false;
}

/**
 * 원격 GET 스냅샷으로 localStorage를 덮으면 안 되는지.
 * 서버(메모리/빈 Redis) 0원·빈 후원·후원 축소가 로컬 실데이터를 지우는 것을 막는다.
 * 의도적 정산 리셋(`settlementResetAt` 원격이 더 최신)은 덮어쓰기를 허용한다.
 */
export function shouldAvoidOverwritingLocalStateWithRemote(
  existing: AppState | null | undefined,
  incoming: AppState | null | undefined
): boolean {
  if (!existing || !incoming) return false;
  const existingReset = Number(existing.settlementResetAt || 0);
  const incomingReset = Number(incoming.settlementResetAt || 0);
  /** 의도적 정산 리셋(멤버 유지·초기화) — stamp 또는 clear 마커 */
  if (incomingReset > existingReset) return false;
  if (Number(incoming.intentionalDonationClearAt || 0) > 0 && isEmptyBroadcastDonationSession(incoming)) {
    return false;
  }
  /** 사고성 멤버1…/빈 후원(stamp 동일·미상승)은 실로스터를 덮지 않음 */
  if (shouldBlockAccidentalEmptyOverwrite(existing, incoming)) {
    return true;
  }
  if (hasMeaningfulMemberRoster(existing) && !hasMeaningfulMemberRoster(incoming)) {
    /**
     * 로컬만 실멤버명(이름 변경)이고 원격은 멤버1·2… 이어도,
     * 원격 후원·합계가 더 풍부하면 덮어쓰기를 허용한다(이름은 apply 측에서 병합).
     * 단 빈 플레이스홀더는 위에서 already blocked.
     */
    const incomingRicher =
      totalCombined(incoming) > totalCombined(existing) ||
      normalizeDonorsArray(incoming.donors).length > normalizeDonorsArray(existing.donors).length;
    if (!incomingRicher) return true;
  }

  return wouldShrinkDonationData(existing, incoming);
}

/** 후원 건수·합계가 줄어드는지 (명시적 리셋 없이 덮어쓰면 안 되는 경우) */
export function wouldShrinkDonationData(
  existing: AppState | null | undefined,
  incoming: AppState | null | undefined
): boolean {
  if (!existing || !incoming) return false;
  const existingDonors = normalizeDonorsArray(existing.donors);
  const incomingDonors = normalizeDonorsArray(incoming.donors);
  const existingTotal = totalCombined(existing);
  const incomingTotal = totalCombined(incoming);

  if (existingDonors.length > 0 && incomingDonors.length === 0) return true;
  if (existingDonors.length > 0 && incomingDonors.length < existingDonors.length) return true;
  if (existingTotal > 0 && incomingTotal === 0) return true;
  if (existingTotal > 0 && incomingTotal < existingTotal * 0.5 && incomingDonors.length <= existingDonors.length) {
    return true;
  }
  return false;
}

export function formatManThousand(n: number): string {
  const safe = Math.max(0, Math.round(n / 1000) * 1000);
  const man = Math.floor(safe / 10000);
  const thousandDigit = Math.floor((safe % 10000) / 1000);
  return thousandDigit ? `${man}.${thousandDigit}` : `${man}`;
}

/** 원 단위 전 자리 표기(관리자 후원 목록·누적 등). 비음수 정수로 반올림 후 천 단위 구분 */
export function formatWonFull(n: number): string {
  const safe = Math.max(0, Math.round(Number(n) || 0));
  return safe.toLocaleString("ko-KR");
}

export function normalizeDonorsFormat(raw: unknown, fallback: DonorsAmountFormat = "full"): DonorsAmountFormat {
  const v = String(raw ?? "").trim();
  if (v === "full") return "full";
  if (v === "short") return "short";
  return fallback;
}

/** 후원·오버레이 공통 금액 문자열 (full=원 단위 그대로 / short=만원 축약) */
export function formatDonorsAmount(n: number, format: DonorsAmountFormat, locale = "ko-KR"): string {
  const safe = Math.max(0, Math.round(Number(n) || 0));
  if (format === "full") return safe.toLocaleString(locale);
  return formatManThousand(safe);
}

export function formatChatLine(state: AppState): string {
  const members = state.members
    .map((m) => `${m.name}${formatManThousand(m.account)}(${formatManThousand(m.toon)})`)
    .join(",");
  const accAgg = new Map<string, number>();
  for (const d of normalizeDonorsArray(state.donors)) {
    if (d.donationExcluded) continue;
    if ((d.target || "account") === "toon") continue;
    accAgg.set(d.name, (accAgg.get(d.name) || 0) + d.amount);
  }
  const accPairs = Array.from(accAgg.entries()).map(([name, amt]) => `${String(name).replace(/\s+/g, "")}${formatManThousand(amt)}`);
  const accStr = accPairs.length ? ` 후원:${accPairs.join(",")}` : "";
  const total = totalAccount(state);
  return `${members}${accStr} 총합:${formatManThousand(total)}`
    .replace(/\s+,/g, ",")
    .replace(/,\s+/g, ",")
    .trim();
}

/** 방송 일자(한국 시간) — 일일 로그·정산 날짜 버킷 */
export function broadcastDateKey(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(d);
}

/** @deprecated broadcastDateKey 사용 */
export function todaysDateKey(d = new Date()): string {
  return broadcastDateKey(d);
}

export function appendDailyLog(snapshot: AppState, userId?: string | null) {
  if (typeof window === "undefined") return;
  try {
    const storageKeyForLog = dailyLogStorageKey(userId);
    const raw = window.localStorage.getItem(storageKeyForLog);
    const logs = raw ? (JSON.parse(raw) as Record<string, unknown[]>) : {};
    const dateKey = todaysDateKey();
    const entry = {
      at: new Date().toISOString(),
      total: totalAccount(snapshot),
      members: snapshot.members,
      donors: snapshot.donors,
    };
    if (!logs[dateKey]) logs[dateKey] = [];
    (logs[dateKey] as unknown[]).push(entry);
    const merged = JSON.stringify(logs);
    window.localStorage.setItem(storageKeyForLog, merged);
    // 서버에 동기화: 기존 서버 데이터와 병합 후 저장 (실패 시 로컬만 유지)
    const q = new URLSearchParams();
    if (userId) q.set("user", userId);
    const baseUrl = q.toString() ? `/api/daily-log?${q.toString()}` : "/api/daily-log";
    fetch(baseUrl, { cache: "no-store", credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((serverLog: Record<string, unknown[]> | null) => {
        let toSave: Record<string, unknown[]>;
        if (serverLog && typeof serverLog === "object") {
          toSave = { ...serverLog };
          if (!toSave[dateKey]) toSave[dateKey] = [];
          (toSave[dateKey] as unknown[]).push(entry);
        } else {
          toSave = JSON.parse(merged) as Record<string, unknown[]>;
        }
        return fetch(baseUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(toSave),
        });
      })
      .catch(() => {});
  } catch {
    // ignore
  }
}

export type DailyLogEntry = {
  at: string;
  total: number;
  members: Member[];
  donors: Donor[];
};

/** 일일 로그에서 가장 최근 스냅샷(후원·멤버 복구용) */
export function pickLatestDailyLogEntry(
  log: Record<string, DailyLogEntry[] | unknown[]> | null | undefined
): DailyLogEntry | null {
  if (!log || typeof log !== "object") return null;
  let best: DailyLogEntry | null = null;
  let bestTs = 0;
  for (const entries of Object.values(log)) {
    if (!Array.isArray(entries)) continue;
    for (const raw of entries) {
      if (!raw || typeof raw !== "object") continue;
      const e = raw as DailyLogEntry;
      const ts = Date.parse(String(e.at || ""));
      if (!Number.isFinite(ts) || ts <= bestTs) continue;
      if (!Array.isArray(e.donors) && !Array.isArray(e.members)) continue;
      bestTs = ts;
      best = e;
    }
  }
  return best;
}

export function loadDailyLog(userId?: string | null): Record<string, DailyLogEntry[]> {
  if (typeof window === "undefined") return {};
  try {
    let raw = window.localStorage.getItem(dailyLogStorageKey(userId));
    if (!raw && userId) {
      raw = window.localStorage.getItem(DAILY_LOG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, DailyLogEntry[]>;
        if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) {
          window.localStorage.setItem(dailyLogStorageKey(userId), raw);
          return parsed;
        }
      }
    }
    return raw ? (JSON.parse(raw) as Record<string, DailyLogEntry[]>) : {};
  } catch {
    return {};
  }
}

export async function loadDailyLogFromApi(userId?: string | null): Promise<Record<string, DailyLogEntry[]>> {
  if (typeof window === "undefined") return {};
  try {
    const q = new URLSearchParams({ _t: String(Date.now()) });
    if (userId) q.set("user", userId);
    const res = await fetch(`/api/daily-log?${q.toString()}`, {
      cache: "no-store",
      credentials: "include",
    });
    if (!res.ok) return {};
    const data = await res.json();
    if (data && typeof data === "object") return data as Record<string, DailyLogEntry[]>;
    return {};
  } catch {
    return {};
  }
}

export function clearDailyLog(userId?: string | null) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(dailyLogStorageKey(userId));
  } catch {
    // ignore
  }
}

export type ForbidEvent = { at: number; author: string; message: string; word: string };
export function appendForbidEvent(ev: ForbidEvent) {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(FORBID_EVENTS_KEY);
    const arr: ForbidEvent[] = raw ? JSON.parse(raw) : [];
    arr.unshift(ev);
    const next = arr.slice(0, 200);
    window.localStorage.setItem(FORBID_EVENTS_KEY, JSON.stringify(next));
  } catch {}
}

export function loadForbidEvents(): ForbidEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(FORBID_EVENTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function confirmHighAmount(amount: number): boolean {
  if (amount >= 1_000_000) {
    return typeof window !== "undefined"
      ? window.confirm("정말 이 금액이 맞습니까?")
      : false;
  }
  return true;
}
