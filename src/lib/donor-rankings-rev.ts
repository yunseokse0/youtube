import type { AppState } from "@/types";

function donorsFingerprint(donors: AppState["donors"]): string {
  if (!Array.isArray(donors) || donors.length === 0) return "0";
  const tail = donors.length > 8 ? donors.slice(-8) : donors;
  let sum = donors.length;
  for (const d of tail) {
    sum += Number(d.at) || 0;
    sum += Number(d.amount) || 0;
    sum += String(d.name || "").length;
  }
  return `${donors.length}:${sum}`;
}

function rankingsUiFingerprint(state: AppState): string {
  return JSON.stringify({
    donorsFormat: state.donorsFormat,
    theme: state.donorRankingsTheme,
    presets: state.donorRankingsPresets,
    presetId: state.donorRankingsPresetId,
    cfg: state.donorRankingsOverlayConfig,
  });
}

/** 후원 순위 오버레이만 갱신이 필요할 때 올리는 revision(회전판·시그 저장과 분리) */
export function computeDonorRankingsUpdatedAt(
  base: AppState,
  next: AppState,
  patch: Partial<AppState>,
  donorsChanged: boolean
): number {
  const prev = Number(base.donorRankingsUpdatedAt || base.updatedAt || 0);
  let changed = donorsChanged;
  if (
    "donorsFormat" in patch ||
    "donorRankingsTheme" in patch ||
    "donorRankingsPresets" in patch ||
    "donorRankingsPresetId" in patch ||
    "donorRankingsOverlayConfig" in patch
  ) {
    changed = true;
  }
  if (!changed && donorsFingerprint(base.donors) !== donorsFingerprint(next.donors)) {
    changed = true;
  }
  if (!changed && rankingsUiFingerprint(base) !== rankingsUiFingerprint(next)) {
    changed = true;
  }
  return changed ? Date.now() : prev;
}

export function readDonorRankingsRevision(state: AppState): number {
  return Number(state.donorRankingsUpdatedAt || state.updatedAt || 0);
}
