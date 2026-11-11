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

/**
 * 과거 정산 회차의 기여도 스냅샷을 현재 방송 상태(AppState)의 기존 엑셀표에만 불러와 복원 적용합니다.
 * - 기존 엑셀표의 members[i].contribution만 복원 (퐁당퐁당 표는 독립 유지하여 언제든 개별 리셋/수집 가능)
 * - 기여도 기록부(contributionLogs)에 복원 추적 로그 기록
 */
export function applyRoundContributionToState(
  state: AppState,
  record: SettlementRecord
): RoundContributionRestoreResult {
  const snapshot = getRoundContributionSnapshot(record);
  const now = Date.now();
  let restoredCount = 0;
  let restoredTotal = 0;
  const memberDetails: Array<{ id: string; name: string; amount: number }> = [];

  const newLogs: ContributionLog[] = [];

  const updatedMembers: Member[] = (state.members || []).map((m) => {
    const valFromId = snapshot[m.id];
    const valFromName = snapshot[m.name];
    const targetVal = valFromId ?? valFromName;

    if (typeof targetVal === "number" && targetVal >= 0) {
      restoredCount += 1;
      restoredTotal += targetVal;
      memberDetails.push({ id: m.id, name: m.name, amount: targetVal });

      if (targetVal > 0) {
        newLogs.push({
          id: `cl_rst_${now}_${Math.random().toString(36).slice(2, 7)}`,
          memberId: m.id,
          delta: 1,
          amount: targetVal,
          note: `[회차 기여도 불러오기: ${record.title}] (${m.name})`,
          at: now,
        });
      }

      return {
        ...m,
        contribution: targetVal,
      };
    }

    return m;
  });

  const nextState: AppState = {
    ...state,
    members: updatedMembers,
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
