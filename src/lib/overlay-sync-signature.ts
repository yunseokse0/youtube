import type { AppState } from "@/types";
import { readManualSigBroadcastFromState } from "@/lib/manual-sig-broadcast-state";
import { canonicalSigIdFromWheelSliceId } from "@/lib/sig-roulette";
import {
  hasMeaningfulMemberRoster,
  membersDifferByIds,
  normalizeDonorsArray,
  shouldBlockAccidentalEmptyOverwrite,
  totalCombined,
} from "@/lib/state";

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
 * - 정산 리셋(remote.settlementResetAt 상승)만 빈 원격 허용 — 단 플레이스홀더 사고성 빈 상태 제외
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
  if (remoteReset > localReset) {
    /** stamp만 앞서고 멤버1·2…/빈 후원이면 강제 리셋으로 보지 않음 */
    if (shouldBlockAccidentalEmptyOverwrite(local, remote)) return true;
    return false;
  }

  /**
   * 의도적 멤버 추가·삭제: id 집합이 바뀌고 원격 stamp 가 최신이면
   * 금액이 잠깐 0이어도(옛 후원이 옛 memberId) poorer 로 막지 않음.
   */
  if (
    hasMeaningfulMemberRoster(remote) &&
    Array.isArray(remote.members) &&
    remote.members.length > 0 &&
    membersDifferByIds(local.members || [], remote.members) &&
    Number(remote.updatedAt || 0) >= Number(local.updatedAt || 0)
  ) {
    return false;
  }

  const localDonorList = Array.isArray(local.donors) ? local.donors : [];
  const remoteDonorList = Array.isArray(remote.donors) ? remote.donors : [];
  const localDonors = localDonorList.length;
  const remoteDonors = remoteDonorList.length;
  /** 정산 리셋 없이 완전 빈 원격은 로컬 후원을 덮지 않음 */
  if (localDonors > 0 && remoteDonors === 0) return true;

  const localTotal = (local.members || []).reduce(
    (sum, m) =>
      sum + Math.max(0, Number(m.account || 0)) + Math.max(0, Number(m.toon || 0)),
    0
  );
  const remoteTotal = (remote.members || []).reduce(
    (sum, m) =>
      sum + Math.max(0, Number(m.account || 0)) + Math.max(0, Number(m.toon || 0)),
    0
  );

  /** 엑셀 실멤버가 플레이스홀더/빈 슬롯으로 덮이지 않게 */
  if (hasMeaningfulMemberRoster(local) && !hasMeaningfulMemberRoster(remote)) {
    /**
     * 이름만 로컬이 앞서고 원격 후원·합계가 더 많으면 거절하지 않음.
     * (관리자 이름 변경 + 서버 실후원 교착 → OBS에 멤버1 고착 방지. 이름은 apply 측 병합)
     */
    const remoteRicher =
      remoteDonors > localDonors ||
      remoteTotal > localTotal ||
      (remoteDonors > 0 && localDonors === 0);
    if (!remoteRicher) return true;
  }

  if (localTotal > 0 && remoteTotal === 0 && remoteDonors === 0) return true;

  /**
   * 엑셀 members 합계가 0인데 서버 donors·revision 만 앞선 경우
   * (후원순위는 되고 엑셀만 0) — poorer 고스트로 막지 않음
   */
  const localMemberTotal = localTotal;
  const remoteDr = Number(remote.donorRankingsUpdatedAt || 0);
  const localDr = Number(local.donorRankingsUpdatedAt || 0);
  if (localMemberTotal === 0 && remoteDonors > 0 && remoteDr > localDr) {
    return false;
  }

  if (!isRicherDonationSnapshot(local, remote)) return false;
  if (isNewerIntentionalDonationShrink(remote, local)) return false;
  return true;
}

/** 후원·멤버 금액이 모두 비어 서버/네트워크 공백으로 볼 수 있는지 */
export function isEmptyDonationRemote(remote: AppState | null | undefined): boolean {
  if (!remote) return true;
  if (normalizeDonorsArray(remote.donors).length > 0) return false;
  if (totalCombined(remote) > 0) return false;
  return true;
}

/**
 * OBS·방송 오버레이: last-good/LS 옛 값이 서버(비어 있지 않은) 스냅샷을 막지 않게.
 * 빈 원격만 로컬 보호 — 새로고침 시 서버와 무관한 숫자 고착 방지.
 */
export function shouldKeepStaleOverlayOverRemote(
  local: AppState | null | undefined,
  remote: AppState | null | undefined
): boolean {
  if (!local || !remote) return false;
  if (!shouldRejectPoorerDonationRemote(local, remote)) return false;
  if (!isEmptyDonationRemote(remote)) return false;
  const remoteReset = Number(remote.settlementResetAt || 0);
  const localReset = Number(local.settlementResetAt || 0);
  if (remoteReset > localReset) return false;
  return true;
}
