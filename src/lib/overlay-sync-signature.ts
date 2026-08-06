import type { AppState } from "@/types";
import { readManualSigBroadcastFromState } from "@/lib/manual-sig-broadcast-state";
import { canonicalSigIdFromWheelSliceId } from "@/lib/sig-roulette";

const MANUAL_SIG_DRAFT_STATE_KEY = "sigSalesManualDraftV1";

/** 시그 판매 OBS — 동일 스냅샷이면 setState·HYDRATE 생략(수동 결과 GIF 깜빡임 방지) */
export function buildSigSalesOverlaySyncSignature(state: AppState | null): string {
  if (!state) return "";
  const os = state.overlaySettings;
  const draft =
    os && typeof os === "object"
      ? (os as Record<string, unknown>)[MANUAL_SIG_DRAFT_STATE_KEY]
      : null;
  const flags =
    draft && typeof draft === "object" && Array.isArray((draft as { sigSoldFlags?: unknown }).sigSoldFlags)
      ? ((draft as { sigSoldFlags: boolean[] }).sigSoldFlags || [])
      : [];
  const draftRows =
    draft && typeof draft === "object" && Array.isArray((draft as { drafts?: unknown }).drafts)
      ? ((draft as { drafts?: Array<{ name?: string; priceInput?: string; imageUrl?: string }> }).drafts || [])
      : [];
  const inv = (state.sigInventory || [])
    .map((r) => ({
      id: canonicalSigIdFromWheelSliceId(r.id),
      sc: Math.floor(Number(r.soldCount || 0)),
      mc: Math.floor(Number(r.maxCount || 1)),
      n: String(r.name || ""),
      p: Math.floor(Number(r.price || 0)),
      iu: String(r.imageUrl || ""),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const broadcast = readManualSigBroadcastFromState(state);
  const selected = broadcast?.selectedSigs || [];
  return JSON.stringify({
    u: state.updatedAt || 0,
    inv,
    flags,
    oneShot: Boolean(
      draft && typeof draft === "object" && (draft as { oneShotMarkSold?: boolean }).oneShotMarkSold
    ),
    /** 수동 한방·행 이미지 URL — 없으면 OBS가 이전 스냅샷을 유지해 한방 GIF가 안 바뀜 */
    osi:
      draft && typeof draft === "object"
        ? String((draft as { oneShotImageUrl?: unknown }).oneShotImageUrl || "").trim()
        : "",
    draftImg: draftRows.map((r) => String(r?.imageUrl || "").trim()).join("\u001f"),
    phase: broadcast?.phase || "",
    nonce: Number(broadcast?.overlayReloadNonce || 0),
    sel: selected.map((s) => canonicalSigIdFromWheelSliceId(s.id)),
    /** selectedSigs.imageUrl — 리롤 후 URL만 바뀌어도 OBS가 갱신되게 */
    selImg: selected.map((s) => String(s.imageUrl || "").trim()).join("\u001f"),
    stamp: state.sigSoldOutStampUrl || "",
  });
}

/**
 * 오버레이 `useRemoteState`가 GET/SSE로 받은 스냅샷을 적용할지 판단하는 서명.
 * 멤버·후원만 넣으면 타이머 스타일·미션·랭킹 UI 등 옵션 변경이 실시간 반영되지 않는다.
 */
export function buildOverlaySyncSignature(state: AppState | null): string {
  if (!state) return "";

  const members = (state.members || [])
    .map((m) => ({
      id: m.id,
      name: m.name,
      account: m.account || 0,
      toon: m.toon || 0,
      contribution: m.contribution || 0,
      restroom: m.restroom || 0,
      operating: Boolean(m.operating),
    }))
    .sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));

  const donors = (state.donors || [])
    .map((d) => ({
      id: d.id,
      name: d.name,
      amount: d.amount || 0,
      target: d.target || "",
      at: d.at || 0,
    }))
    .sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));

  const generalTimer = state.generalTimer
    ? {
        remainingTime: state.generalTimer.remainingTime,
        isActive: state.generalTimer.isActive,
        lastUpdated: state.generalTimer.lastUpdated,
      }
    : null;

  const sigRolling = state.sigRolling
    ? {
        hold: Math.floor(Number(state.sigRolling.staticHoldMs) || 0),
        fade: Math.floor(Number(state.sigRolling.fadeMs) || 0),
        items: (state.sigRolling.items || [])
          .map((x) => `${x.id}\u001f${x.url}`)
          .join("\u001e"),
      }
    : null;

  const rollingInv = (state.sigInventory || [])
    .map((r) => ({
      id: canonicalSigIdFromWheelSliceId(r.id),
      roll: Boolean(r.isRolling),
      active: Boolean(r.isActive),
      p: Math.floor(Number(r.price) || 0),
      iu: String(r.imageUrl || ""),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const rollingMeta = Object.keys(state.sigRollingMeta || {})
    .sort()
    .map((id) => {
      const m = state.sigRollingMeta?.[id];
      return `${id}\u001f${m?.label || ""}\u001f${Math.floor(Number(m?.order) || 0)}`;
    })
    .join("\u001e");

  return JSON.stringify({
    members,
    donors,
    memberPositions: state.memberPositions || {},
    rankPositionLabels: state.rankPositionLabels || [],
    generalTimer,
    matchTimerEnabled: state.matchTimerEnabled || {},
    timerDisplayStyles: state.timerDisplayStyles || {},
    overlaySettings: state.overlaySettings || {},
    overlayPresets: state.overlayPresets || [],
    missions: state.missions || [],
    donorRankingsOverlayConfig: state.donorRankingsOverlayConfig || {},
    donorRankingsFullTheme: state.donorRankingsFullTheme || {},
    donorRankingsFullOverlayConfig: state.donorRankingsFullOverlayConfig || {},
    donationListsOverlayConfig: state.donationListsOverlayConfig || {},
    mealBattle: state.mealBattle || {},
    sigMatchSettings: state.sigMatchSettings || {},
    sigMatch: state.sigMatch || {},
    /** 시그 롤링 표시 시간·목록 — 서명에 없으면 OBS가 설정 변경을 무시함 */
    sigRolling,
    rollingInv,
    rollingMeta,
    sigSalesExcludedIds: state.sigSalesExcludedIds || [],
  });
}

/** 원격/로컬 스냅샷이 현재 표시보다 후원 금액·건수가 많으면 갱신 후보 */
export function isRicherDonationSnapshot(
  candidate: AppState | null | undefined,
  baseline: AppState | null | undefined
): boolean {
  if (!candidate) return false;
  const cAccount = (candidate.members || []).reduce(
    (sum, m) => sum + Math.max(0, Math.floor(Number(m.account || 0))),
    0
  );
  const cToon = (candidate.members || []).reduce(
    (sum, m) => sum + Math.max(0, Math.floor(Number(m.toon || 0))),
    0
  );
  const cDonors = Array.isArray(candidate.donors) ? candidate.donors.length : 0;
  if (!baseline) return cAccount + cToon > 0 || cDonors > 0;
  const bAccount = (baseline.members || []).reduce(
    (sum, m) => sum + Math.max(0, Math.floor(Number(m.account || 0))),
    0
  );
  const bToon = (baseline.members || []).reduce(
    (sum, m) => sum + Math.max(0, Math.floor(Number(m.toon || 0))),
    0
  );
  const bDonors = Array.isArray(baseline.donors) ? baseline.donors.length : 0;
  /** 계좌·투네 합계 우선 — 투네 1건이 큰 수동 계좌를 ‘richer’로 이기지 않게 */
  const cTotal = cAccount + cToon;
  const bTotal = bAccount + bToon;
  if (cTotal !== bTotal) return cTotal > bTotal;
  if (cToon !== bToon) return cToon > bToon;
  if (cAccount !== bAccount) return cAccount > bAccount;
  return cDonors > bDonors;
}

/**
 * 관리자 수동 삭제 등 — 더 최신 LS 가 금액·건수만 줄어든 경우.
 * 이 때 last-good 이 “더 많다”고 빈 서버 forceFull 하면 엑셀표가 통째로 0 이 된다.
 */
export function isNewerIntentionalDonationShrink(
  newer: AppState | null | undefined,
  older: AppState | null | undefined
): boolean {
  if (!newer || !older) return false;
  const newerAt = Number(newer.updatedAt || 0);
  const olderAt = Number(older.updatedAt || 0);
  if (!(newerAt >= olderAt && newerAt > 0)) return false;
  const newerDonors = Array.isArray(newer.donors) ? newer.donors : [];
  const olderDonors = Array.isArray(older.donors) ? older.donors : [];
  const olderIds = new Set(olderDonors.map((d) => String(d.id || "")).filter(Boolean));
  const newerIds = newerDonors.map((d) => String(d.id || "")).filter(Boolean);
  if (newerIds.some((id) => !olderIds.has(id))) return false;
  if (newerDonors.length > olderDonors.length) return false;
  if (newerDonors.length === olderDonors.length && !isRicherDonationSnapshot(older, newer)) {
    return false;
  }
  return isRicherDonationSnapshot(older, newer) || newerDonors.length < olderDonors.length;
}

/**
 * 빈/축소 원격으로 로컬·엑셀 후원을 시스템에 의해 지우면 안 된다.
 * - 정산 리셋(remote.settlementResetAt 상승)만 빈 원격 허용
 * - 의도적 부분 삭제(subset shrink)는 허용
 * - 신규 id·revision 만으로 poorer 원격 허용하지 않음
 *   (투네 1건이 수동 계좌 붙여넣기를 통째로 덮지 않게 — 호출측에서 union)
 * - 그 외 poorer·완전 빈 원격은 거부
 */
export function shouldRejectPoorerDonationRemote(
  local: AppState | null | undefined,
  remote: AppState | null | undefined
): boolean {
  if (!local || !remote) return false;
  const remoteReset = Number(remote.settlementResetAt || 0);
  const localReset = Number(local.settlementResetAt || 0);
  if (remoteReset > localReset) return false;

  const localDonorList = Array.isArray(local.donors) ? local.donors : [];
  const remoteDonorList = Array.isArray(remote.donors) ? remote.donors : [];
  const localDonors = localDonorList.length;
  const remoteDonors = remoteDonorList.length;
  /** 정산 리셋 없이 완전 빈 원격은 로컬 후원을 덮지 않음 */
  if (localDonors > 0 && remoteDonors === 0) return true;

  if (!isRicherDonationSnapshot(local, remote)) return false;
  if (isNewerIntentionalDonationShrink(remote, local)) return false;
  return true;
}
