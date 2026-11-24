import type { AppState, ContributionLog, Member, SettlementRecord } from "@/types";

/**
 * 정산 레코드에서 회차 기여도 스냅샷 맵(memberId/name -> 금액)을 추출합니다.
 */
export function getRoundContributionSnapshot(
  record: SettlementRecord | null | undefined
): Record<string, number> {
  if (!record) return {};
  const map: Record<string, number> = {};

  if (record.roundContributionSnapshot && typeof record.roundContributionSnapshot === "object") {
    for (const [k, v] of Object.entries(record.roundContributionSnapshot)) {
      const num = Math.max(0, Number(v) || 0);
      if (num > 0) map[k] = num;
    }
  }

  // members 배열의 contribution 필드도 보충
  for (const m of record.members || []) {
    const id = String(m.memberId || m.name || "").trim();
    const contrib = Math.max(0, Number(m.contribution) || 0);
    if (contrib > 0) {
      if (id && map[id] == null) map[id] = contrib;
      if (m.name && map[m.name] == null) map[m.name] = contrib;
    }
  }

  return map;
}

/**
 * 정산 레코드에 복원 가능한 회차 기여도가 있는지 검사합니다.
 */
export function hasSavedRoundContribution(
  record: SettlementRecord | null | undefined
): boolean {
  if (!record) return false;
  if (record.saveRoundContribution === false) return false;
  const snapshot = getRoundContributionSnapshot(record);
  return Object.values(snapshot).some((v) => v > 0);
}

export type RoundContributionRestoreResult = {
  nextState: AppState;
  restoredCount: number;
  restoredTotal: number;
  memberDetails: Array<{ id: string; name: string; amount: number }>;
};

export type RoundContributionRestoreOptions = {
  applyToStandardExcel?: boolean;
  applyToPongdangExcel?: boolean;
};

export type LastResetContributionSnapshot = {
  resetAt: number;
  contributions: Record<string, number>;
  memberNames: Record<string, string>;
  total: number;
};

export const LAST_RESET_CONTRIBUTION_KEY = "admin_last_settlement_reset_contribution_v1";

/**
 * 정산 리셋 실행 직전의 멤버별 기여도 스냅샷을 브라우저에 자동 보관합니다.
 */
export function saveLastResetContributionSnapshot(
  state: AppState,
  userId?: string | null,
  autoSigContribMap?: Map<string, number>
): LastResetContributionSnapshot | null {
  if (typeof window === "undefined") return null;
  const contributions: Record<string, number> = {};
  const memberNames: Record<string, string> = {};
  let total = 0;

  for (const m of state.members || []) {
    memberNames[m.id] = m.name;
    const baseContrib = Math.max(0, Number(m.contribution) || 0);
    const manualPongdang = Math.max(0, Number(state.pongdangManualContributions?.[m.id]) || 0);
    const autoPongdang = autoSigContribMap?.get(m.id) || 0;
    const pongdangTotal = manualPongdang + autoPongdang;
    const val = Math.max(baseContrib, pongdangTotal);
    if (val > 0) {
      contributions[m.id] = val;
      total += val;
    }
  }

  const snapshot: LastResetContributionSnapshot = {
    resetAt: Date.now(),
    contributions,
    memberNames,
    total,
  };

  try {
    const key = userId ? `${LAST_RESET_CONTRIBUTION_KEY}_${userId}` : LAST_RESET_CONTRIBUTION_KEY;
    window.localStorage.setItem(key, JSON.stringify(snapshot));
    window.localStorage.setItem(LAST_RESET_CONTRIBUTION_KEY, JSON.stringify(snapshot));
  } catch {}

  return snapshot;
}

/**
 * 직전 정산 리셋 시 보관된 기여도 스냅샷을 불러옵니다.
 */
export function loadLastResetContributionSnapshot(
  userId?: string | null
): LastResetContributionSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const key = userId ? `${LAST_RESET_CONTRIBUTION_KEY}_${userId}` : LAST_RESET_CONTRIBUTION_KEY;
    const raw = window.localStorage.getItem(key) || window.localStorage.getItem(LAST_RESET_CONTRIBUTION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.contributions) {
      return parsed as LastResetContributionSnapshot;
    }
  } catch {}
  return null;
}

/**
 * 직전 정산 리셋 스냅샷을 현재 상태(AppState)에 1클릭 복원 적용합니다.
 */
export function applyLastResetContributionToState(
  state: AppState,
  snapshot: LastResetContributionSnapshot,
  opts?: RoundContributionRestoreOptions
): RoundContributionRestoreResult {
  const now = Date.now();
  let restoredCount = 0;
  let restoredTotal = 0;
  const memberDetails: Array<{ id: string; name: string; amount: number }> = [];
  const newLogs: ContributionLog[] = [];

  const applyStandard = opts?.applyToStandardExcel !== false;
  const applyPongdang = opts?.applyToPongdangExcel !== false;

  const nextPongdangManual: Record<string, number> = {
    ...(state.pongdangManualContributions || {}),
  };

  const updatedMembers: Member[] = (state.members || []).map((m) => {
    const targetVal = snapshot.contributions[m.id] ?? snapshot.contributions[m.name];

    if (typeof targetVal === "number" && targetVal >= 0) {
      restoredCount += 1;
      restoredTotal += targetVal;
      memberDetails.push({ id: m.id, name: m.name, amount: targetVal });

      if (targetVal > 0 && applyStandard) {
        newLogs.push({
          id: `cl_rst_${now}_${Math.random().toString(36).slice(2, 7)}`,
          memberId: m.id,
          delta: 1,
          amount: targetVal,
          note: `[정산 리셋 기여도 복원] (${m.name})`,
          at: now,
        });
      }

      if (applyPongdang) {
        nextPongdangManual[m.id] = targetVal;
      }

      if (applyStandard) {
        return {
          ...m,
          contribution: targetVal,
        };
      }
    }

    return m;
  });

  const nextState: AppState = {
    ...state,
    members: applyStandard ? updatedMembers : state.members,
    ...(applyPongdang
      ? {
          pongdangManualContributions: nextPongdangManual,
          pongdangManualMode: true,
        }
      : {}),
    contributionLogs: [...newLogs, ...(state.contributionLogs || [])].slice(0, 300),
    updatedAt: now,
  };

  return {
    nextState,
    restoredCount,
    restoredTotal,
    memberDetails,
  };
}

/**
 * 과거 정산 회차의 기여도 스냅샷을 현재 방송 상태(AppState)의 엑셀표에 불러와 복원 적용합니다.
 * - 기본: 기존 엑셀표(members[i].contribution) 복원
 * - applyToPongdangExcel: true 지정 시 퐁당퐁당 수동 기여도(pongdangManualContributions)에도 함께 반영
 * - 기여도 기록부(contributionLogs)에 복원 추적 로그 기록
 */
export function applyRoundContributionToState(
  state: AppState,
  record: SettlementRecord,
  opts?: RoundContributionRestoreOptions
): RoundContributionRestoreResult {
  const snapshot = getRoundContributionSnapshot(record);
  const now = Date.now();
  let restoredCount = 0;
  let restoredTotal = 0;
  const memberDetails: Array<{ id: string; name: string; amount: number }> = [];

  const newLogs: ContributionLog[] = [];
  const applyStandard = opts?.applyToStandardExcel !== false;
  const applyPongdang = opts?.applyToPongdangExcel === true;

  const nextPongdangManual: Record<string, number> = {
    ...(state.pongdangManualContributions || {}),
  };

  const updatedMembers: Member[] = (state.members || []).map((m) => {
    const valFromId = snapshot[m.id];
    const valFromName = snapshot[m.name];
    const targetVal = valFromId ?? valFromName;

    if (typeof targetVal === "number" && targetVal >= 0) {
      restoredCount += 1;
      restoredTotal += targetVal;
      memberDetails.push({ id: m.id, name: m.name, amount: targetVal });

      if (targetVal > 0 && applyStandard) {
        newLogs.push({
          id: `cl_rst_${now}_${Math.random().toString(36).slice(2, 7)}`,
          memberId: m.id,
          delta: 1,
          amount: targetVal,
          note: `[회차 기여도 불러오기: ${record.title}] (${m.name})`,
          at: now,
        });
      }

      if (applyPongdang) {
        nextPongdangManual[m.id] = targetVal;
      }

      if (applyStandard) {
        return {
          ...m,
          contribution: targetVal,
        };
      }
    }

    return m;
  });

  const nextState: AppState = {
    ...state,
    members: applyStandard ? updatedMembers : state.members,
    ...(applyPongdang
      ? {
          pongdangManualContributions: nextPongdangManual,
          pongdangManualMode: true,
        }
      : {}),
    contributionLogs: [...newLogs, ...(state.contributionLogs || [])].slice(0, 300),
    updatedAt: now,
  };

  return {
    nextState,
    restoredCount,
    restoredTotal,
    memberDetails,
  };
}
