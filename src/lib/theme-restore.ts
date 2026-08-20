import {
  DEFAULT_DONOR_RANKINGS_FULL_THEME,
  isDefaultLikeDonorRankingsTheme,
  isDefaultLikeOverlayPresets,
  migrateLegacyLocalStorageKey,
  normalizeDonorsArray,
  overlayPresetsStorageKey,
  storageKey,
  totalCombined,
  type AppState,
} from "@/lib/state";
import {
  isServerAuthoritativeBroadcastState,
  readSessionBroadcastState,
} from "@/lib/server-authoritative-broadcast-state";

export type ThemeRestoreCandidate = {
  source: string;
  score: number;
  updatedAt: number;
  overlayPresets?: AppState["overlayPresets"];
  donorRankingsTheme?: AppState["donorRankingsTheme"];
  donorRankingsFullTheme?: AppState["donorRankingsFullTheme"];
  donorRankingsPresets?: AppState["donorRankingsPresets"];
  donorRankingsPresetId?: string;
  overlaySettings?: AppState["overlaySettings"];
};

type ThemeRestoreFields = Pick<
  ThemeRestoreCandidate,
  | "overlayPresets"
  | "donorRankingsTheme"
  | "donorRankingsFullTheme"
  | "donorRankingsPresets"
  | "donorRankingsPresetId"
  | "overlaySettings"
>;

function readJsonRecord(raw: string | null): Record<string, unknown> | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function scoreThemeRestoreFields(fields: ThemeRestoreFields): number {
  let score = 0;
  if (fields.overlayPresets?.length && !isDefaultLikeOverlayPresets(fields.overlayPresets)) {
    score += 100;
    const theme = String((fields.overlayPresets[0] as { theme?: string })?.theme || "default");
    if (theme !== "default") score += 40;
  }
  if (
    fields.donorRankingsTheme &&
    !isDefaultLikeDonorRankingsTheme(fields.donorRankingsTheme)
  ) {
    score += 30;
  }
  if (
    fields.donorRankingsFullTheme &&
    !isDefaultLikeDonorRankingsTheme(fields.donorRankingsFullTheme, DEFAULT_DONOR_RANKINGS_FULL_THEME)
  ) {
    score += 20;
  }
  if (fields.donorRankingsPresets?.length) score += 10;
  if (fields.overlaySettings && Object.keys(fields.overlaySettings).length > 0) score += 5;
  return score;
}

function candidateFromState(
  raw: Record<string, unknown> | null,
  source: string,
  overlayPresetsOverride?: AppState["overlayPresets"]
): ThemeRestoreCandidate | null {
  if (!raw && !overlayPresetsOverride?.length) return null;
  const overlayPresets =
    overlayPresetsOverride ??
    (Array.isArray(raw?.overlayPresets)
      ? (raw!.overlayPresets as AppState["overlayPresets"])
      : undefined);
  const fields: ThemeRestoreFields = {
    overlayPresets,
    donorRankingsTheme:
      raw?.donorRankingsTheme && typeof raw.donorRankingsTheme === "object"
        ? (raw.donorRankingsTheme as AppState["donorRankingsTheme"])
        : undefined,
    donorRankingsFullTheme:
      raw?.donorRankingsFullTheme && typeof raw.donorRankingsFullTheme === "object"
        ? (raw.donorRankingsFullTheme as AppState["donorRankingsFullTheme"])
        : undefined,
    donorRankingsPresets: Array.isArray(raw?.donorRankingsPresets)
      ? (raw!.donorRankingsPresets as AppState["donorRankingsPresets"])
      : undefined,
    donorRankingsPresetId:
      typeof raw?.donorRankingsPresetId === "string" ? raw.donorRankingsPresetId : undefined,
    overlaySettings:
      raw?.overlaySettings && typeof raw.overlaySettings === "object"
        ? (raw.overlaySettings as AppState["overlaySettings"])
        : undefined,
  };
  const score = scoreThemeRestoreFields(fields);
  if (score <= 0) return null;
  return {
    source,
    score,
    updatedAt: Number(raw?.updatedAt || 0),
    ...fields,
  };
}

/** localStorage·프리셋 캐시에서 커스텀 테마 후보 수집 */
export function collectThemeRestoreCandidates(userId?: string | null): ThemeRestoreCandidate[] {
  if (typeof window === "undefined") return [];
  const out: ThemeRestoreCandidate[] = [];

  const mainRaw = isServerAuthoritativeBroadcastState()
    ? (readSessionBroadcastState(userId) as Record<string, unknown> | null)
    : readJsonRecord(window.localStorage.getItem(storageKey(userId)));
  const main = candidateFromState(mainRaw, "브라우저 방송 상태");
  if (main) out.push(main);

  try {
    const presetKey = overlayPresetsStorageKey(userId);
    const presetRaw =
      migrateLegacyLocalStorageKey("excel-broadcast-overlay-presets", presetKey) ||
      window.localStorage.getItem(presetKey);
    if (presetRaw) {
      const parsed = JSON.parse(presetRaw) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) {
        const fromCache = candidateFromState(null, "오버레이 프리셋 캐시", parsed as AppState["overlayPresets"]);
        if (fromCache) out.push(fromCache);
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const legacyRaw = window.localStorage.getItem("excel-broadcast-overlay-presets");
    if (legacyRaw) {
      const parsed = JSON.parse(legacyRaw) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) {
        const fromLegacy = candidateFromState(null, "구버전 프리셋 캐시", parsed as AppState["overlayPresets"]);
        if (fromLegacy) out.push(fromLegacy);
      }
    }
  } catch {
    /* ignore */
  }

  return out.sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt);
}

export function pickBestThemeRestoreCandidate(
  candidates: ThemeRestoreCandidate[]
): ThemeRestoreCandidate | null {
  const eligible = candidates.filter((c) => c.score >= 50);
  if (!eligible.length) return null;
  return [...eligible].sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt)[0] ?? null;
}

export function describeOverlayThemeLabel(presets: unknown): string {
  if (!Array.isArray(presets) || !presets[0] || typeof presets[0] !== "object") return "기본(핑크 그라데이션)";
  const p = presets[0] as { theme?: string; name?: string };
  const theme = String(p.theme || "default");
  const name = String(p.name || "").trim();
  if (name) return name;
  if (theme === "excelLive") return "방송 엑셀(계좌·투네)";
  if (theme === "excel") return "엑셀표";
  if (theme !== "default") return theme;
  return "기본(핑크 그라데이션)";
}

export function summarizeThemeRestoreCandidate(candidate: ThemeRestoreCandidate): string[] {
  const lines: string[] = [];
  if (candidate.overlayPresets?.length) {
    lines.push(`오버레이 테마: ${describeOverlayThemeLabel(candidate.overlayPresets)}`);
  }
  if (
    candidate.donorRankingsTheme &&
    !isDefaultLikeDonorRankingsTheme(candidate.donorRankingsTheme)
  ) {
    lines.push("후원순위 테마");
  }
  if (
    candidate.donorRankingsFullTheme &&
    !isDefaultLikeDonorRankingsTheme(candidate.donorRankingsFullTheme, DEFAULT_DONOR_RANKINGS_FULL_THEME)
  ) {
    lines.push("후원순위(전체) 테마");
  }
  return lines;
}

export function shouldOfferThemeRestore(
  current: AppState,
  candidate: ThemeRestoreCandidate | null | undefined
): boolean {
  if (!candidate || candidate.score < 50) return false;
  const overlayReset =
    isDefaultLikeOverlayPresets(current.overlayPresets) &&
    Boolean(candidate.overlayPresets?.length) &&
    !isDefaultLikeOverlayPresets(candidate.overlayPresets);
  const donorThemeReset =
    isDefaultLikeDonorRankingsTheme(current.donorRankingsTheme) &&
    Boolean(candidate.donorRankingsTheme) &&
    !isDefaultLikeDonorRankingsTheme(candidate.donorRankingsTheme);
  return overlayReset || donorThemeReset;
}

/** 테마 복구 안내 무시(탭·재접속 공통) — 동일 후보를 반복 묻지 않음 */
export function themeRestoreDismissStorageKey(userId?: string | null): string {
  const uid = String(userId || "").trim() || "anon";
  return `excel-broadcast-theme-restore-dismissed:${uid}`;
}

export function themeRestoreCandidateFingerprint(candidate: ThemeRestoreCandidate): string {
  const theme = candidate.overlayPresets?.length
    ? describeOverlayThemeLabel(candidate.overlayPresets)
    : "";
  return [
    candidate.source,
    String(candidate.score),
    String(candidate.updatedAt || 0),
    theme,
  ].join("|");
}

export type ThemeRestoreDismissRecord = {
  fingerprint: string;
  at: number;
};

export function readThemeRestoreDismiss(userId?: string | null): ThemeRestoreDismissRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(themeRestoreDismissStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ThemeRestoreDismissRecord;
    if (!parsed || typeof parsed.fingerprint !== "string") return null;
    return {
      fingerprint: parsed.fingerprint,
      at: Number(parsed.at) || 0,
    };
  } catch {
    return null;
  }
}

export function markThemeRestoreDismissed(
  userId: string | null | undefined,
  candidate: ThemeRestoreCandidate
): void {
  if (typeof window === "undefined") return;
  try {
    const record: ThemeRestoreDismissRecord = {
      fingerprint: themeRestoreCandidateFingerprint(candidate),
      at: Date.now(),
    };
    window.localStorage.setItem(themeRestoreDismissStorageKey(userId), JSON.stringify(record));
  } catch {
    /* ignore */
  }
}

/** 사용자가 이미 「취소」한 동일 후보면 다시 묻지 않음. 후보가 바뀌면(다른 테마·갱신) 다시 제안 */
export function isThemeRestoreDismissedForCandidate(
  userId: string | null | undefined,
  candidate: ThemeRestoreCandidate
): boolean {
  const dismissed = readThemeRestoreDismiss(userId);
  if (!dismissed?.fingerprint) return false;
  return dismissed.fingerprint === themeRestoreCandidateFingerprint(candidate);
}

/**
 * 라이브 상태가 비어 보이는데 LS에 후원이 있으면 후원·멤버만 되살린다(테마는 유지).
 * 테마 복구 「취소」후 빈 스냅샷에 남는 경우를 막는다.
 */
export function healDonationFieldsFromLocalSnapshot(
  live: AppState,
  local: AppState
): AppState | null {
  const liveReset = Number(live.settlementResetAt || 0);
  const localReset = Number(local.settlementResetAt || 0);
  /** 서버(라이브) 정산 리셋이 더 최신이면 LS 구 후원을 되살리지 않음 */
  if (liveReset > localReset) return null;
  const liveDonors = normalizeDonorsArray(live.donors).length;
  const localDonorsRaw = normalizeDonorsArray(local.donors);
  const localDonorsFiltered =
    liveReset > 0
      ? localDonorsRaw.filter((d) => (d.at || 0) >= liveReset - 3000)
      : localDonorsRaw;
  const localDonors = localDonorsFiltered.length;
  const liveTotal = totalCombined(live);
  const localTotal = localDonorsFiltered.length
    ? localDonorsFiltered.reduce((s, d) => s + Math.max(0, Math.round(Number(d.amount) || 0)), 0)
    : totalCombined(local);
  const localRicher =
    localDonors > liveDonors ||
    localTotal > liveTotal ||
    (localTotal > 0 && liveTotal === 0) ||
    (localDonors > 0 && liveDonors === 0);
  if (!localRicher) return null;
  return {
    ...live,
    members: local.members?.length ? local.members : live.members,
    donors: localDonorsFiltered,
    memberPositions: local.memberPositions ?? live.memberPositions,
    settlementResetAt: Math.max(liveReset, localReset) || live.settlementResetAt || local.settlementResetAt,
    updatedAt: Math.max(Number(live.updatedAt) || 0, Number(local.updatedAt) || 0, Date.now()),
  };
}

/** 멤버·후원은 유지하고 테마 필드만 복구 */
export function applyThemeRestorePatch(
  base: AppState,
  candidate: ThemeRestoreCandidate
): AppState {
  const next: AppState = {
    ...base,
    updatedAt: Date.now(),
  };
  if (candidate.overlayPresets?.length) {
    next.overlayPresets = candidate.overlayPresets;
  }
  if (
    candidate.donorRankingsTheme &&
    !isDefaultLikeDonorRankingsTheme(candidate.donorRankingsTheme)
  ) {
    next.donorRankingsTheme = candidate.donorRankingsTheme;
  }
  if (
    candidate.donorRankingsFullTheme &&
    !isDefaultLikeDonorRankingsTheme(candidate.donorRankingsFullTheme, DEFAULT_DONOR_RANKINGS_FULL_THEME)
  ) {
    next.donorRankingsFullTheme = candidate.donorRankingsFullTheme;
  }
  if (candidate.donorRankingsPresets?.length) {
    next.donorRankingsPresets = candidate.donorRankingsPresets;
  }
  if (candidate.donorRankingsPresetId) {
    next.donorRankingsPresetId = candidate.donorRankingsPresetId;
  }
  if (candidate.overlaySettings && typeof candidate.overlaySettings === "object") {
    next.overlaySettings = {
      ...((base.overlaySettings && typeof base.overlaySettings === "object"
        ? base.overlaySettings
        : {}) as Record<string, unknown>),
      ...(candidate.overlaySettings as Record<string, unknown>),
    } as AppState["overlaySettings"];
  }
  return next;
}
