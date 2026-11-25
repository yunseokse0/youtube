"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AdminPopupShell from "@/components/admin/popup/AdminPopupShell";
import { useAdminPopupBroadcastState } from "@/hooks/useAdminPopupBroadcastState";
import { showAppToast } from "@/lib/app-toast";
import { isOperatingSettlementMember } from "@/lib/settlement-utils";
import { reassignDonorMemberInAppState } from "@/domain/contribution/apply-donation.usecases";
import { persistDonationStateViaApi } from "@/lib/donation/persist-donation-client";
import { writeSessionBroadcastState } from "@/lib/server-authoritative-broadcast-state";
import {
  notifyBroadcastStateLocalUpdated,
  notifyOverlayPresetsLocalUpdated,
  notifyAdminPreviewDonorsUpdated,
} from "@/lib/broadcast-state-local-sync";
import { storageKey } from "@/lib/state";
import { overlayPresetsStorageKey } from "@/lib/state";
import { isPongdangContributionLog, syncMemberTotalsFromDonors } from "@/domain/sync/sync-repair-1pass";
import { parseOverlayContributionNumber } from "@/lib/overlay-donation-aggregate";
import { collectPongdangPopupAutoContributionByMember } from "@/lib/pongdang-popup-contribution";
import { formatMealBattleFromAtInput, parseMealBattleFromAtInput } from "@/lib/battle-donation-sync";
import type { AppState, ContributionLog, Member } from "@/types";

function formatAmount(n: number): string {
  const num = Math.round(Number(n) || 0);
  return num.toLocaleString("ko-KR");
}

function formatTime(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return "";
  const d = new Date(ts);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

type FilterType = "all" | "auto" | "manual" | "minus";

export default function AdminPongdangPopupPanel() {
  const {
    user,
    scopedUserId,
    urlUserId,
    authReady,
    state,
    setState,
    stateRef,
    runExclusivePersist,
    accountMismatch,
    persistAppState,
    sseConnected,
    reload,
  } = useAdminPopupBroadcastState();

  const [query, setQuery] = useState("");
  const [filterMemberId, setFilterMemberId] = useState<string>("all");
  const [filterType, setFilterType] = useState<FilterType>("all");

  // 수동 기여도 입력 폼 상태
  const [newLogMemberId, setNewLogMemberId] = useState<string>("");
  const [newLogDonorName, setNewLogDonorName] = useState<string>("");
  const [newLogAmount, setNewLogAmount] = useState<string>("");
  const [newLogIsMinus, setNewLogIsMinus] = useState<boolean>(false);
  const [newLogNote, setNewLogNote] = useState<string>("");

  const members = useMemo<Member[]>(() => {
    return Array.isArray(state?.members) ? state.members : [];
  }, [state?.members]);

  const memberPositions = state?.memberPositions;

  // 퐁당퐁당 엑셀표 및 백오피스에서 제외된 멤버 ID 집합
  const excludedMemberIdsSet = useMemo(() => {
    const ids = new Set<string>();
    for (const id of state?.pongdangExcludedMemberIds || []) {
      if (id) ids.add(String(id).trim());
    }
    const pongdangPresets = (state?.overlayPresets || []).filter(
      (p: any) =>
        p.day777Calc ||
        p.theme === "excelPongdang" ||
        p.membersTheme === "excelPongdang" ||
        String(p.name || "").includes("퐁당")
    );
    for (const p of pongdangPresets) {
      const pList = Array.isArray((p as any).excludedMemberIds)
        ? (p as any).excludedMemberIds
        : typeof (p as any).excludedMemberIds === "string"
        ? String((p as any).excludedMemberIds).split(",")
        : [];
      for (const id of pList) {
        if (id && String(id).trim()) ids.add(String(id).trim());
      }
    }
    return ids;
  }, [state?.pongdangExcludedMemberIds, state?.overlayPresets]);

  // 퐁당퐁당 기여도 관리에 실제 참여하는 멤버들 (제외된 멤버 필터링)
  const participatingMembers = useMemo(() => {
    return members.filter((m) => !excludedMemberIdsSet.has(m.id));
  }, [members, excludedMemberIdsSet]);

  // 1. 자동 수집된 777 시그 기여도 맵 (pongdangMinus 반영)
  const autoSigContributionMap = useMemo<Map<string, number>>(() => {
    return collectPongdangPopupAutoContributionByMember(state);
  }, [state]);

  // 2. 수동 기여도 로그 합산 맵 (delta = 1 or -1) — 퐁당퐁당 전용 로그만 합산 및 리셋 시점 적용
  const manualLogMap = useMemo<Map<string, number>>(() => {
    const map = new Map<string, number>();
    const rawReset = Number(state?.pongdangResetAt || 0);
    if (rawReset === -1) return map;
    let cutoff = Math.max(0, rawReset);
    if (cutoff === 0 && Array.isArray(state?.overlayPresets)) {
      for (const p of state.overlayPresets) {
        const isPd =
          p.membersTheme === "excelPongdang" ||
          p.theme === "excelPongdang" ||
          Boolean(p.day777Calc) ||
          String(p.name || "").includes("퐁당");
        if (isPd && p.donationAggregateFromAt) {
          const fromAtN = Number(p.donationAggregateFromAt);
          if (Number.isFinite(fromAtN) && fromAtN > 0) {
            cutoff = fromAtN;
            break;
          }
        }
      }
    }
    const memberIdNormalizeMap = new Map<string, string>();
    for (const m of members) {
      if (m.id) memberIdNormalizeMap.set(String(m.id).trim(), String(m.id).trim());
      if (m.name) memberIdNormalizeMap.set(String(m.name).trim(), String(m.id).trim());
    }
    const logs = state?.contributionLogs || [];
    for (const l of logs) {
      if (l.isZubzubBonus) continue;
      // ⭐️ 메인 엑셀표 수동 기여도는 퐁당퐁당에 절대 반영하지 않음 (퐁당 전용 로그만)
      if (!isPongdangContributionLog(l)) continue;
      if (cutoff > 0 && Number(l.at || 0) < cutoff) continue;
      const rawMid = String(l.memberId || "").trim();
      if (!rawMid) continue;
      const mid = memberIdNormalizeMap.get(rawMid) || rawMid;
      const rawAmount = parseOverlayContributionNumber(l.amount);
      const amt = Math.floor(Math.abs(rawAmount));
      const delta = l.delta === -1 || rawAmount < 0 ? -1 : 1;
      map.set(mid, (map.get(mid) || 0) + delta * amt);
    }
    return map;
  }, [state?.contributionLogs, state?.pongdangResetAt, state?.overlayPresets, members]);

  // 3. 멤버별 최종 퐁당퐁당 기여도 계산 (제외된 멤버는 기여도 관리에 미포함)
  const memberSummaries = useMemo(() => {
    const isManualMode = state?.pongdangManualMode !== false;
    const manualContribs = state?.pongdangManualContributions || {};

    const list = participatingMembers.map((m) => {
      const isOperating = isOperatingSettlementMember(m, memberPositions);
      const autoVal = autoSigContributionMap.get(m.id) ?? 0;
      const logVal = manualLogMap.get(m.id) ?? 0;
      const directManualVal = parseOverlayContributionNumber(manualContribs[m.id]);
      const totalManual = logVal + directManualVal;
      // 음수 기여도 허용 (Math.max 제거)
      const finalContribution = isManualMode ? autoVal + totalManual : autoVal;
      const role = (memberPositions?.[m.id] || "").trim() || ((m as any).role || "").trim();

      return {
        member: m,
        role,
        isOperating,
        autoVal,
        logVal,
        directManualVal,
        totalManual,
        finalContribution,
      };
    });
    const orderIndex = new Map(members.map((m, idx) => [m.id, idx]));
    return list.sort((a, b) => {
      // 운영비는 맨 아래로
      if (a.isOperating !== b.isOperating) return a.isOperating ? 1 : -1;
      // 기여도 내림차순 정렬 (음수는 양수 아래로)
      if (b.finalContribution !== a.finalContribution) {
        return b.finalContribution - a.finalContribution;
      }
      const ia = orderIndex.get(a.member.id) ?? 999;
      const ib = orderIndex.get(b.member.id) ?? 999;
      return ia - ib;
    });
  }, [participatingMembers, members, memberPositions, autoSigContributionMap, manualLogMap, state?.pongdangManualMode, state?.pongdangManualContributions]);

  // 총합 계산 (음수 포함)
  const totals = useMemo(() => {
    let autoSum = 0;
    let manualSum = 0;
    let finalSum = 0;
    for (const s of memberSummaries) {
      if (s.isOperating) continue;
      autoSum += s.autoVal;
      manualSum += s.totalManual;
      finalSum += s.finalContribution;
    }
    return { autoSum, manualSum, finalSum };
  }, [memberSummaries]);

  // 4. 후원자별 · 건별 기여도 내역 통합 리스트
  type PongdangItemRow = {
    key: string;
    sourceType: "auto_sig" | "manual_log";
    rawId: string;
    at: number;
    donorName: string;
    memberId: string;
    memberName: string;
    amount: number;
    isMinus: boolean;
    reason: string;
    target?: string;
    isAutoAssigned?: boolean;
    rawMemberId?: string;
    isZubzubBonus?: boolean;
  };

  const itemRows = useMemo<PongdangItemRow[]>(() => {
    if (!state) return [];
    const list: PongdangItemRow[] = [];
    const memberNameMap = new Map<string, string>();
    const memberIdNormalizeMap = new Map<string, string>();
    for (const m of members) {
      if (m.id) {
        memberNameMap.set(String(m.id).trim(), m.name);
        memberIdNormalizeMap.set(String(m.id).trim(), String(m.id).trim());
      }
      if (m.name) {
        memberIdNormalizeMap.set(String(m.name).trim(), String(m.id).trim());
      }
    }

    // A. 자동 후원/시그에서 발생한 건
    const rawReset = Number(state.pongdangResetAt || 0);
    let cutoff = Math.max(0, rawReset);
    if (cutoff === 0 && Array.isArray(state.overlayPresets)) {
      for (const p of state.overlayPresets) {
        const isPd =
          p.membersTheme === "excelPongdang" ||
          p.theme === "excelPongdang" ||
          Boolean(p.day777Calc) ||
          String(p.name || "").includes("퐁당");
        if (isPd && p.donationAggregateFromAt) {
          const fromAtN = Number(p.donationAggregateFromAt);
          if (Number.isFinite(fromAtN) && fromAtN > 0) {
            cutoff = fromAtN;
            break;
          }
        }
      }
    }
    const isTurnedOff = rawReset === -1;
    const includeZubzubBonus =
      state.pongdangIncludeZubzub !== undefined
        ? Boolean(state.pongdangIncludeZubzub)
        : Boolean(state.zubzubSettings?.applyContributionToPongdang);
    const applyDoubleToPongdang = state.zubzubSettings?.applyDoubleContributionToPongdang !== false;
    const zubzubLogKeys = new Set(
      (state.contributionLogs || [])
        .filter((log) => log.isZubzubBonus)
        .map((log) => log.zubzubQueueId || log.id)
    );
    const donors = isTurnedOff ? [] : (state.donors || []).filter(
      (d) => (!d.donationExcluded && !(d.isZubzubBonus && !includeZubzubBonus)) || (includeZubzubBonus && d.isZubzubBonus)
    );
    for (const d of donors) {
      if (!includeZubzubBonus && d.isZubzubBonus) continue;
      if (
        d.isZubzubBonus &&
        zubzubLogKeys.has(d.zubzubQueueId || d.id)
      ) {
        continue;
      }
      if (cutoff > 0 && Number(d.at || 0) < cutoff) continue;
      const isAutoAssigned = Boolean(d.memberAutoAssigned);
      const rawMid = String(d.memberId || "").trim();
      const mid = memberIdNormalizeMap.get(rawMid) || rawMid;
      // 제외된 멤버의 기여도 건은 퐁당퐁당 내역에서 제외 (단, 아직 미지정 상태인 건은 제외하지 않음)
      if (!isAutoAssigned && mid && excludedMemberIdsSet.has(mid)) continue;
      const rawSigPrice = parseOverlayContributionNumber(
        d.sigPrice || (d.isZubzubBonus ? (!applyDoubleToPongdang && d.sigPrice ? d.sigPrice : (d.contributionPoints || d.amount)) : 0)
      );
      const sigPrice = Math.floor(Math.abs(rawSigPrice));
      const rawContributionPoints = parseOverlayContributionNumber(d.contributionPoints);
      const cp = Math.floor(Math.abs(rawContributionPoints));
      const amt = Math.floor(Math.abs(parseOverlayContributionNumber(d.amount)));
      const isCredit = Boolean(d.isSigCredit || d.isZubzubBonus);
      const hasSigInMessage = typeof d.message === "string" && (d.message.includes("시그") || d.message.includes("777"));
      let val = 0;
      if (sigPrice > 0) val = sigPrice;
      else if (isCredit && cp > 0) val = cp;
      else if (cp > 0 && amt !== 777000 && cp !== amt) val = cp;
      else if (cp > 0 && hasSigInMessage) val = cp;

      if (val > 0) {
        list.push({
          key: `donor_${d.id}`,
          sourceType: "auto_sig",
          rawId: d.id,
          at: Number(d.at) || Date.now(),
          donorName: d.isZubzubBonus ? (d.donorName || "대표 시그 줍줍") : (d.donorName || d.name || "후원자"),
          memberId: isAutoAssigned ? "" : mid,
          rawMemberId: mid,
          memberName: isAutoAssigned ? "미지정 (자동지정 대기)" : (memberNameMap.get(mid) || "미지정"),
          amount: val,
          isMinus: Boolean(d.pongdangMinus) || rawSigPrice < 0 || rawContributionPoints < 0,
          reason: d.isZubzubBonus
            ? (d.message || "🎁 대표 시그 줍줍 보너스")
            : (d.message ? `777 시그 후원 (${d.message})` : "777데이 룰렛·시그 당첨"),
          target: d.target || "account",
          isAutoAssigned,
        });
      }
    }

    // B. 수동 기여도 로그
    const logs = state.contributionLogs || [];
    for (const l of logs) {
      if (l.isZubzubBonus) {
        if (!includeZubzubBonus) continue;
        if (cutoff > 0 && Number(l.at || 0) < cutoff) continue;
        const rawMid = String(l.memberId || "").trim();
        if (!rawMid) continue;
        const mid = memberIdNormalizeMap.get(rawMid) || rawMid;
        if (mid && excludedMemberIdsSet.has(mid)) continue;
        let effAmount = l.amount;
        if (!applyDoubleToPongdang) {
          const isAutoClaim =
            l.baseSigPrice &&
            l.multiplier &&
            l.multiplier > 1 &&
            l.amount === l.baseSigPrice * (l.multiplier - 1);
          effAmount = isAutoClaim ? 0 : (l.baseSigPrice ?? 0);
        }
        const val = Math.floor(Math.abs(parseOverlayContributionNumber(effAmount)));
        list.push({
          key: `log_${l.id}`,
          sourceType: "auto_sig",
          rawId: l.id,
          at: Number(l.at) || Date.now(),
          donorName: l.donorName || "대표 시그 줍줍",
          memberId: mid,
          rawMemberId: mid,
          memberName: memberNameMap.get(mid) || "미지정",
          amount: val,
          isMinus: Boolean(l.pongdangMinus) || parseOverlayContributionNumber(l.amount) < 0,
          reason: l.note || `🎁 대표 시그 줍줍 보너스${l.multiplier ? ` (${l.multiplier}배)` : ""}`,
          isZubzubBonus: true,
        });
        continue;
      }
      // ⭐️ 메인 엑셀표 수동 기여도 로그는 퐁당퐁당 내역에 표시하지 않음 (퐁당 전용 로그만)
      if (!isPongdangContributionLog(l)) continue;
      if (cutoff > 0 && Number(l.at || 0) < cutoff) continue;
      const rawMid = String(l.memberId || "").trim();
      if (!rawMid) continue;
      const mid = memberIdNormalizeMap.get(rawMid) || rawMid;
      if (mid && excludedMemberIdsSet.has(mid)) continue;
      const rawAmount = parseOverlayContributionNumber(l.amount);
      const val = Math.floor(Math.abs(rawAmount));
      list.push({
        key: `log_${l.id}`,
        sourceType: "manual_log",
        rawId: l.id,
        at: Number(l.at) || Date.now(),
        donorName: l.donorName || "관리자 수동",
        memberId: mid,
        rawMemberId: mid,
        memberName: memberNameMap.get(mid) || "미지정",
        amount: val,
        isMinus: l.delta === -1 || rawAmount < 0,
        reason: l.note || (l.delta === -1 || rawAmount < 0 ? "수동 기여도 차감" : "수동 기여도 추가"),
      });
    }

    // 최신순 정렬
    return list.sort((a, b) => b.at - a.at);
  }, [state, members, excludedMemberIdsSet]);

  // 필터링 적용된 행들
  const filteredRows = useMemo(() => {
    return itemRows.filter((r) => {
      if (filterMemberId !== "all" && r.memberId !== filterMemberId) return false;
      if (filterType === "auto" && r.sourceType !== "auto_sig") return false;
      if (filterType === "manual" && r.sourceType !== "manual_log") return false;
      if (filterType === "minus" && !r.isMinus) return false;

      if (query.trim()) {
        const q = query.trim().toLowerCase();
        const matchName = r.donorName.toLowerCase().includes(q);
        const matchMember = r.memberName.toLowerCase().includes(q);
        const matchReason = r.reason.toLowerCase().includes(q);
        if (!matchName && !matchMember && !matchReason) return false;
      }
      return true;
    });
  }, [itemRows, filterMemberId, filterType, query]);

  // 후원(donors) 수정 시 서버 영구 반영 (마이너스 처리, 멤버 재배정)
  const persistDonorsReplace = useCallback(
    async (nextState: AppState): Promise<boolean> => {
      const stamped = syncMemberTotalsFromDonors({
        ...nextState,
        updatedAt: Date.now(),
        donorRankingsUpdatedAt: Date.now(),
      });
      setState(stamped);
      stateRef.current = stamped;
      writeSessionBroadcastState(stamped, scopedUserId);
      try {
        if (typeof window !== "undefined") {
          window.localStorage.setItem(storageKey(scopedUserId), JSON.stringify(stamped));
        }
      } catch {}
      notifyBroadcastStateLocalUpdated(scopedUserId, stamped.updatedAt);
      if (Array.isArray(stamped.overlayPresets)) {
        try {
          const pKey = overlayPresetsStorageKey(scopedUserId);
          window.localStorage.setItem(pKey, JSON.stringify(stamped.overlayPresets));
          window.localStorage.setItem("excel-broadcast-overlay-presets", JSON.stringify(stamped.overlayPresets));
          notifyOverlayPresetsLocalUpdated();
        } catch {}
      }
      notifyAdminPreviewDonorsUpdated(scopedUserId, stamped.donors || [], stamped.updatedAt);
      const result = await runExclusivePersist(() =>
        persistDonationStateViaApi(scopedUserId, stamped, "replace", {
          returnState: false,
          /**
           * ✅ 이 패널은 후원을 「수정」만 한다 (마이너스 토글·멤버 재배정). 삭제가 없으므로 removedDonorIds=[].
           *  이 값을 빼면 서버가 replace 로 장부를 통째 교체하면서, 이 탭이 아직 못 받은 신규 후원
           *  (허브·toona 가 방금 넣은 건)까지 지워 「후원 유입 누락·금액 불일치」가 발생한다.
           *  [] 를 보내면 서버가 이 탭이 못 본 후원을 남긴다(keepServerDonorsUnseenByReplace).
           */
          removedDonorIds: [],
        })
      );
      if (!result.ok) {
        showAppToast("후원 변경사항 서버 저장 실패", { variant: "error" });
        return false;
      }
      return true;
    },
    [runExclusivePersist, scopedUserId, setState, stateRef]
  );

  // 작업 핸들러: 마이너스 처리 토글 (Donor 또는 ContributionLog)
  const toggleRowMinus = useCallback(async (row: PongdangItemRow) => {
    if (!state) return;
    if (row.sourceType === "auto_sig") {
      if (row.isZubzubBonus) {
        const nextLogs = (state.contributionLogs || []).map((log) =>
          log.id === row.rawId ? { ...log, pongdangMinus: !log.pongdangMinus } : log
        );
        const nextState: AppState = { ...state, contributionLogs: nextLogs };
        setState(nextState);
        stateRef.current = nextState;
        const ok = await persistDonorsReplace(nextState);
        if (ok) {
          showAppToast(
            row.isMinus
              ? `[${row.memberName}] ${row.donorName} 기여도를 정상(+)으로 복원했습니다.`
              : `[${row.memberName}] ${row.donorName} 기여도를 마이너스(-) 처리했습니다.`,
            { variant: "success" }
          );
        }
        return;
      }
      // 자동 시그/후원 건 pongdangMinus 토글
      const nextDonors = (state.donors || []).map((d) => {
        if (String(d.id) === String(row.rawId)) {
          const nextMinus = !d.pongdangMinus;
          return { ...d, pongdangMinus: nextMinus };
        }
        return d;
      });
      const nextState: AppState = { ...state, donors: nextDonors };
      const ok = await persistDonorsReplace(nextState);
      if (ok) {
        showAppToast(
          row.isMinus
            ? `[${row.memberName}] ${row.donorName} 기여도를 정상(+)으로 복원했습니다.`
            : `[${row.memberName}] ${row.donorName} 기여도를 마이너스(-) 처리했습니다.`,
          { variant: "success" }
        );
      }
    } else {
      // 수동 기여도 로그 delta 토글 (1 <-> -1)
      const nextLogs = (state.contributionLogs || []).map((l) => {
        if (l.id === row.rawId) {
          const nextDelta: 1 | -1 = l.delta === -1 ? 1 : -1;
          return { ...l, delta: nextDelta, isPongdang: true };
        }
        return l;
      });
      const nextState: AppState = { ...state, contributionLogs: nextLogs };
      setState(nextState);
      stateRef.current = nextState;
      const ok = await persistDonorsReplace(nextState);
      if (ok) {
        showAppToast(
          row.isMinus
            ? `[${row.memberName}] 수동 기여도를 정상(+)으로 복원했습니다.`
            : `[${row.memberName}] 수동 기여도를 마이너스(-) 처리했습니다.`,
          { variant: "success" }
        );
      }
    }
  }, [state, persistDonorsReplace, setState]);

  // 작업 핸들러: 수동 로그 삭제
  const deleteManualLog = useCallback(async (logId: string) => {
    if (!state) return;
    if (!window.confirm("이 수동 기여도 내역을 완전히 삭제하시겠습니까?")) return;
    const nextLogs = (state.contributionLogs || []).filter((l) => l.id !== logId);
    const nextDeletedIds = Array.from(new Set([...(state.deletedContributionLogIds || []), logId]));
    const nextState: AppState = {
      ...state,
      contributionLogs: nextLogs,
      deletedContributionLogIds: nextDeletedIds,
    };
    setState(nextState);
    stateRef.current = nextState;
    const ok = await persistDonorsReplace(nextState);
    if (ok) {
      showAppToast("수동 기여도 내역을 삭제했습니다.", { variant: "info" });
    }
  }, [state, setState, persistDonorsReplace, stateRef]);

  // 작업 핸들러: 자동 후원 건 대상 멤버 변경/지정 (미지정 상태 해제 및 기여도 즉시 반영)
  const assignDonorMember = useCallback(async (donorId: string, memberId: string) => {
    if (!state) return;
    const next = reassignDonorMemberInAppState(state, donorId, memberId);
    if (!next) return;
    const ok = await persistDonorsReplace(next);
    if (ok) {
      const targetName = members.find((m) => m.id === memberId)?.name || memberId;
      showAppToast(`[${targetName}] 멤버에게 배정 완료되었습니다 (퐁당퐁당 기여도 즉시 반영).`, { variant: "success" });
    }
  }, [state, persistDonorsReplace, members]);

  // 작업 핸들러: 퐁당퐁당 멤버 참여/제외 토글
  const toggleMemberExclusion = useCallback(async (memberId: string) => {
    if (!state) return;
    const isCurrentlyExcluded = excludedMemberIdsSet.has(memberId);
    const currentGlobal = state.pongdangExcludedMemberIds || [];
    const nextGlobal = isCurrentlyExcluded
      ? currentGlobal.filter((id) => id !== memberId)
      : Array.from(new Set([...currentGlobal, memberId]));

    const nextPresets = (state.overlayPresets || []).map((p: any) => {
      const isPongdang =
        p.day777Calc ||
        p.theme === "excelPongdang" ||
        p.membersTheme === "excelPongdang" ||
        String(p.name || "").includes("퐁당");
      if (!isPongdang) return p;
      const pCurrent = Array.isArray(p.excludedMemberIds)
        ? p.excludedMemberIds
        : typeof p.excludedMemberIds === "string"
        ? String(p.excludedMemberIds).split(",").map((s: string) => s.trim()).filter(Boolean)
        : [];
      const nextPList = isCurrentlyExcluded
        ? pCurrent.filter((id: string) => id !== memberId)
        : Array.from(new Set([...pCurrent, memberId]));
      return { ...p, excludedMemberIds: nextPList };
    });

    const nextState: AppState = {
      ...state,
      pongdangExcludedMemberIds: nextGlobal,
      overlayPresets: nextPresets,
    };
    setState(nextState);
    const ok = await persistAppState(nextState);
    if (ok) {
      const mName = members.find((m) => m.id === memberId)?.name || memberId;
      showAppToast(
        isCurrentlyExcluded
          ? `[${mName}] 멤버를 퐁당퐁당 기여도 관리에 포함했습니다.`
          : `[${mName}] 멤버를 퐁당퐁당 기여도 관리에서 제외했습니다.`,
        { variant: "info" }
      );
    }
  }, [state, setState, persistAppState, excludedMemberIdsSet, members]);

  // 작업 핸들러: 신규 수동 기여도 추가/마이너스 등록
  const submitNewManualContribution = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!state) return;
    const targetMid = newLogMemberId || participatingMembers[0]?.id;
    if (!targetMid) {
      window.alert("대상 멤버를 선택해주세요.");
      return;
    }
    const amt = Math.abs(parseInt(newLogAmount.replace(/[^\d]/g, ""), 10) || 0);
    if (amt <= 0) {
      window.alert("기여도 금액을 1원 이상 입력해주세요.");
      return;
    }

    const targetMember = members.find((m) => m.id === targetMid);
    const newLog: ContributionLog = {
      id: `cl_pd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      memberId: targetMid,
      donorName: newLogDonorName.trim() || undefined,
      amount: amt,
      delta: newLogIsMinus ? -1 : 1,
      note: newLogNote.trim() || (newLogIsMinus ? "퐁당퐁당 수동 차감" : "퐁당퐁당 수동 추가"),
      at: Date.now(),
      ...({ isPongdang: true } as any),
    };

    const nextLogs = [newLog, ...(state.contributionLogs || [])];
    const nextState: AppState = { ...state, contributionLogs: nextLogs };
    setState(nextState);
    stateRef.current = nextState;
    const ok = await persistDonorsReplace(nextState);
    if (ok) {
      showAppToast(
        `[${targetMember?.name || "멤버"}] ${newLogIsMinus ? "마이너스 기여도 (-" : "기여도 (+"}${formatAmount(amt)}원) 등록 완료!`,
        { variant: "success" }
      );
      setNewLogAmount("");
      setNewLogNote("");
      setNewLogDonorName("");
    }
  }, [state, members, participatingMembers, newLogMemberId, newLogAmount, newLogIsMinus, newLogDonorName, newLogNote, setState, persistDonorsReplace, stateRef]);

  // 작업 핸들러: 멤버별 직접 수동 보정 가감 (음수 가능)
  const adjustDirectManual = useCallback(async (memberId: string, deltaAmount: number) => {
    if (!state) return;
    const current = Number(state.pongdangManualContributions?.[memberId]) || 0;
    const nextVal = current + deltaAmount;
    const nextManual = {
      ...(state.pongdangManualContributions || {}),
      [memberId]: nextVal,
    };
    const nextState: AppState = { ...state, pongdangManualContributions: nextManual };
    setState(nextState);
    stateRef.current = nextState;
    await persistDonorsReplace(nextState);
  }, [state, setState, persistDonorsReplace, stateRef]);

  // 작업 핸들러: 멤버별 직접 수동 보정값 설정 (음수 가능)
  const setDirectManual = useCallback(async (memberId: string, value: number) => {
    if (!state) return;
    const nextManual = {
      ...(state.pongdangManualContributions || {}),
      [memberId]: value,
    };
    const nextState: AppState = { ...state, pongdangManualContributions: nextManual };
    setState(nextState);
    stateRef.current = nextState;
    await persistDonorsReplace(nextState);
  }, [state, setState, persistDonorsReplace, stateRef]);

  // 작업 핸들러: 퐁당퐁당 수동 보정 모드 토글
  const toggleManualMode = useCallback(async () => {
    if (!state) return;
    const nextMode = state.pongdangManualMode === false;
    const nextState: AppState = { ...state, pongdangManualMode: nextMode };
    setState(nextState);
    stateRef.current = nextState;
    const ok = await persistAppState(nextState);
    if (ok) {
      showAppToast(
        nextMode ? "수동 보정값을 상시 합산합니다." : "수동 보정값을 제외하고 순수 자동만 집계합니다.",
        { variant: "info" }
      );
    }
  }, [state, setState, persistAppState, stateRef]);

  // 작업 핸들러: 퐁당퐁당 엑셀표에 줍줍 기여도 반영 여부 토글
  const toggleZubzubBonus = useCallback(async () => {
    if (!state) return;
    const currentActive =
      state.pongdangIncludeZubzub !== undefined
        ? Boolean(state.pongdangIncludeZubzub)
        : Boolean(state.zubzubSettings?.applyContributionToPongdang);
    const nextVal = !currentActive;
    const nextZubzubSettings = {
      ...(state.zubzubSettings || { enabled: true, minSigPrice: 0 }),
      applyContributionToPongdang: nextVal,
    };
    const nextPresets = (state.overlayPresets as any[] || []).map((p) => {
      const isPd =
        p.membersTheme === "excelPongdang" ||
        p.theme === "excelPongdang" ||
        Boolean(p.day777Calc) ||
        String(p.name || "").includes("퐁당");
      return isPd ? { ...p, pongdangIncludeZubzub: nextVal } : p;
    });
    const nextState: AppState = {
      ...state,
      pongdangIncludeZubzub: nextVal,
      zubzubSettings: nextZubzubSettings,
      overlayPresets: nextPresets,
      updatedAt: Date.now(),
    };
    setState(nextState);
    stateRef.current = nextState;
    await persistDonorsReplace(nextState);
    showAppToast(
      nextVal
        ? "퐁당퐁당 엑셀표에 줍줍 기여도를 반영합니다."
        : "퐁당퐁당 엑셀표에서 줍줍 기여도를 제외했습니다.",
      { variant: nextVal ? "success" : "info" }
    );
  }, [state, setState, persistDonorsReplace, stateRef]);

  const [pongdangFromAtInput, setPongdangFromAtInput] = useState<string>("");

  useEffect(() => {
    if (state?.pongdangResetAt && state.pongdangResetAt > 0) {
      setPongdangFromAtInput(formatMealBattleFromAtInput(state.pongdangResetAt));
    } else {
      setPongdangFromAtInput("");
    }
  }, [state?.pongdangResetAt]);

  const applyChosenTime = useCallback(async (timeMs: number) => {
    if (!state || !timeMs || timeMs <= 0) return;
    const nextPresets = (state.overlayPresets || []).map((p: any) =>
      p.membersTheme === "excelPongdang" || p.theme === "excelPongdang" || Boolean(p.day777Calc) || String(p.name || "").includes("퐁당")
        ? { ...p, donationAggregateFromAt: String(timeMs) }
        : p
    );
    const nextState: AppState = {
      ...state,
      pongdangResetAt: timeMs,
      overlayPresets: nextPresets,
    };
    setState(nextState);
    stateRef.current = nextState;
    const ok = await persistDonorsReplace(nextState);
    if (ok) {
      showAppToast("지정된 일시 이후 후원/시그 기록에서 퐁당퐁당 기여도를 책정합니다.", { variant: "success" });
    }
  }, [state, setState, persistDonorsReplace, stateRef]);

  const applyAllTime = useCallback(async () => {
    if (!state) return;
    if (!window.confirm("기존 모든 후원 원장 및 룰렛 시그 기록에서 퐁당퐁당 기여도를 다시 계산하여 불러올까요?")) return;
    const nextPresets = (state.overlayPresets || []).map((p: any) =>
      p.membersTheme === "excelPongdang" || p.theme === "excelPongdang" || Boolean(p.day777Calc) || String(p.name || "").includes("퐁당")
        ? { ...p, donationAggregateFromAt: "" }
        : p
    );
    const nextState: AppState = {
      ...state,
      pongdangResetAt: 0,
      overlayPresets: nextPresets,
    };
    setState(nextState);
    stateRef.current = nextState;
    const ok = await persistDonorsReplace(nextState);
    if (ok) {
      showAppToast("전체 기간의 기존 후원/시그 기록에서 퐁당퐁당 기여도를 다시 불러왔습니다.", { variant: "success" });
    }
  }, [state, setState, persistDonorsReplace, stateRef]);

  const applyFromNow = useCallback(async () => {
    if (!state) return;
    const now = Date.now();
    const nextPresets = (state.overlayPresets || []).map((p: any) =>
      p.membersTheme === "excelPongdang" || p.theme === "excelPongdang" || Boolean(p.day777Calc) || String(p.name || "").includes("퐁당")
        ? { ...p, donationAggregateFromAt: String(now) }
        : p
    );
    const nextState: AppState = {
      ...state,
      pongdangResetAt: now,
      overlayPresets: nextPresets,
    };
    setState(nextState);
    stateRef.current = nextState;
    const ok = await persistDonorsReplace(nextState);
    if (ok) {
      showAppToast("지금부터 들어오는 후원/시그만 퐁당퐁당 기여도에 책정합니다.", { variant: "success" });
    }
  }, [state, setState, persistDonorsReplace, stateRef]);

  // 작업 핸들러: 0원 전체 초기화
  const resetAllPongdang = useCallback(async () => {
    if (!state) return;
    if (!window.confirm("퐁당퐁당 기여도(자동 집계 및 수동 보정)를 모두 0원으로 완전히 초기화하시겠습니까?")) return;
    const now = Date.now();
    const nextManual: Record<string, number> = {};
    for (const m of state.members || []) {
      nextManual[m.id] = 0;
    }
    const pongdangLogs = (state.contributionLogs || []).filter((l) => isPongdangContributionLog(l));
    const pongdangLogIds = pongdangLogs.map((l) => l.id);
    const nextLogs = (state.contributionLogs || []).filter((l) => !isPongdangContributionLog(l));
    const nextDeletedIds = Array.from(new Set([...(state.deletedContributionLogIds || []), ...pongdangLogIds]));
    const nextPresets = (state.overlayPresets || []).map((p: any) =>
      p.membersTheme === "excelPongdang" || p.theme === "excelPongdang" || Boolean(p.day777Calc) || String(p.name || "").includes("퐁당")
        ? { ...p, donationAggregateFromAt: String(now) }
        : p
    );
    const nextState: AppState = {
      ...state,
      pongdangResetAt: now,
      pongdangManualContributions: nextManual,
      overlayPresets: nextPresets,
      contributionLogs: nextLogs,
      deletedContributionLogIds: nextDeletedIds,
      rouletteState: state.rouletteState
        ? {
            ...state.rouletteState,
            results: [],
            result: null,
            selectedSigs: [],
            historyLogs: [],
          }
        : state.rouletteState,
      overlaySettings: state.overlaySettings
        ? {
            ...state.overlaySettings,
            sigSalesManualBroadcastV1: {
              phase: "IDLE",
              startedAt: 0,
              selectedSigs: [],
              oneShotResult: null,
              overlayReloadNonce: (state.overlaySettings as any)?.sigSalesManualBroadcastV1?.overlayReloadNonce
                ? (state.overlaySettings as any).sigSalesManualBroadcastV1.overlayReloadNonce + 1
                : 1,
            },
          }
        : state.overlaySettings,
    };
    setState(nextState);
    stateRef.current = nextState;
    const ok = await persistDonorsReplace(nextState);
    if (ok) {
      showAppToast("퐁당퐁당 기여도를 0원으로 초기화했습니다.", { variant: "success" });
    }
  }, [state, setState, persistDonorsReplace, stateRef]);

  return (
    <AdminPopupShell
      title="🎪 퐁당퐁당 (777데이) 엑셀 관리"
      subtitle="후원자별 기여도 표시 · 건별 마이너스 처리 · 수동 기여도 가감 (음수 기여도 지원)"
      userId={scopedUserId}
      sessionUserId={user?.id}
      urlUserId={urlUserId || undefined}
      accountMismatch={accountMismatch}
      loading={!authReady || !state}
    >
      <div className="space-y-4 max-w-7xl mx-auto pb-12">
        {/* 상단 퀵 컨트롤 바 */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl border border-amber-500/30 bg-[#160d05]/90 backdrop-blur shadow-lg shadow-amber-950/20">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">🎪</span>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-black text-amber-200 text-sm sm:text-base">퐁당퐁당 엑셀 전용 관리창</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                  state?.pongdangManualMode !== false
                    ? "bg-emerald-950/80 border border-emerald-500/40 text-emerald-300"
                    : "bg-neutral-800 text-neutral-400"
                }`}>
                  {state?.pongdangManualMode !== false ? "✓ 자동+수동 합산 중" : "순수 자동만 반영 중"}
                </span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                  includeZubzubBonus
                    ? "bg-amber-950/80 border border-amber-500/40 text-amber-300"
                    : "bg-neutral-800 text-neutral-400"
                }`}>
                  {includeZubzubBonus ? "🎁 줍줍 반영 ON" : "줍줍 미반영"}
                </span>
                <span className={`w-2 h-2 rounded-full ${sseConnected ? "bg-emerald-400 animate-pulse" : "bg-neutral-500"}`} title={sseConnected ? "실시간 연동 완료" : "연결 대기"} />
              </div>
              <p className="text-xs text-neutral-400 mt-0.5">
                건별 기여도에 대한 마이너스 처리 및 수동 추가/차감이 가능하며, 기여도는 음수(-)로 표출될 수 있습니다.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                includeZubzubBonus
                  ? "bg-amber-600 hover:bg-amber-500 text-white shadow shadow-amber-950/40"
                  : "bg-neutral-800 hover:bg-neutral-700 text-neutral-400 border border-white/10"
              }`}
              onClick={toggleZubzubBonus}
              title="활성화 시 퐁당퐁당 엑셀표에 줍줍 기여도를 합산합니다."
            >
              {includeZubzubBonus ? "✓ 🎁 줍줍 기여도 반영" : "🎁 줍줍 미반영"}
            </button>
            <button
              type="button"
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                state?.pongdangManualMode !== false
                  ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow"
                  : "bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-white/10"
              }`}
              onClick={toggleManualMode}
            >
              {state?.pongdangManualMode !== false ? "✓ 수동 보정 포함" : "수동 미반영 (순수 자동)"}
            </button>
            <button
              type="button"
              className="px-3 py-1.5 rounded-lg text-xs font-bold text-rose-200 bg-rose-950/80 hover:bg-rose-900 border border-rose-500/40 transition cursor-pointer"
              onClick={resetAllPongdang}
            >
              🔄 0원 초기화
            </button>
            <button
              type="button"
              className="px-3 py-1.5 rounded-lg text-xs font-bold text-neutral-300 bg-neutral-800 hover:bg-neutral-700 border border-white/10 transition cursor-pointer"
              onClick={() => reload()}
            >
              새로고침
            </button>
          </div>
        </div>

        {/* ⏱️ 집계 기준 시각 제어 바 (과거 시간 선택 / 전체 기간 복원 지원) */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 p-3 rounded-xl border border-sky-500/35 bg-[#0a1826]/90 backdrop-blur shadow-md">
          <div className="flex items-center gap-2">
            <span className="text-sm">⏱️</span>
            <span className="text-xs font-bold text-sky-200">집계 기준 시각:</span>
            <span className="px-2 py-0.5 rounded bg-sky-950/90 border border-sky-400/40 font-mono text-xs text-sky-100 font-semibold shadow-inner">
              {state?.pongdangResetAt === -1 ? (
                <span className="text-rose-400 font-bold">⛔ 책정 OFF</span>
              ) : state?.pongdangResetAt && state.pongdangResetAt > 0 ? (
                <span className="text-sky-300">
                  ⏱️ {new Date(state.pongdangResetAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} 이후 후원/시그 집계 중
                </span>
              ) : (
                <span className="text-emerald-300 font-bold">✅ 전체 기간 (기존 모든 후원/시그 집계 중)</span>
              )}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 ml-auto">
            <button
              type="button"
              className="px-3 py-1.5 rounded-lg bg-emerald-950/80 hover:bg-emerald-900 text-emerald-200 border border-emerald-500/50 text-xs font-bold shadow-sm transition flex items-center gap-1 cursor-pointer"
              onClick={applyAllTime}
              title="과거 모든 후원 원장 및 룰렛 시그 기록에서 퐁당퐁당 기여도를 온전히 다시 집계합니다"
            >
              <span>✅</span> 전체 기간 (기존 후원 재집계)
            </button>
            <button
              type="button"
              className="px-3 py-1.5 rounded-lg bg-sky-950/80 hover:bg-sky-900 text-sky-200 border border-sky-400/50 text-xs font-bold shadow-sm transition flex items-center gap-1 cursor-pointer"
              onClick={applyFromNow}
              title="지금 이 순간 이후의 룰렛/시그/후원만 퐁당퐁당 기여도로 책정합니다"
            >
              <span>⏱️</span> 현재 시간부터
            </button>
            <div className="flex items-center gap-1.5 pl-2 border-l border-white/10">
              <span className="text-xs text-neutral-300">📅 특정 일시:</span>
              <input
                type="datetime-local"
                className="px-2 py-1 rounded-lg bg-black/60 border border-white/20 text-xs text-white focus:border-sky-400 focus:outline-none font-mono"
                value={pongdangFromAtInput}
                onChange={(e) => setPongdangFromAtInput(e.target.value)}
              />
              <button
                type="button"
                className="px-2.5 py-1 rounded-lg bg-sky-700 hover:bg-sky-600 text-white text-xs font-bold shadow-sm transition cursor-pointer"
                onClick={() => applyChosenTime(parseMealBattleFromAtInput(pongdangFromAtInput, 0))}
              >
                이 시각부터 책정
              </button>
            </div>
          </div>
        </div>

        {/* 👥 퐁당퐁당 참여/제외 멤버 설정 바 */}
        <div className="rounded-xl border border-white/15 bg-neutral-900/80 p-3 shadow-lg">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2 mb-2.5">
            <div className="flex items-center gap-2">
              <span className="text-base">👥</span>
              <span className="text-xs font-bold text-neutral-200">
                퐁당퐁당 엑셀표 참여 멤버 설정 ({participatingMembers.length}/{members.length}명 참여)
              </span>
            </div>
            <span className="text-[11px] text-neutral-400">
              클릭하여 제외(취소선/빨간색)하면 퐁당퐁당 순위표 및 기여도 관리에서 즉시 제외됩니다.
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {members.map((m) => {
              const isExcluded = excludedMemberIdsSet.has(m.id);
              const role = (memberPositions?.[m.id] || "").trim() || ((m as any).role || "").trim();
              return (
                <button
                  key={`pd-exclude-${m.id}`}
                  type="button"
                  onClick={() => toggleMemberExclusion(m.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all flex items-center gap-1.5 cursor-pointer ${
                    isExcluded
                      ? "bg-rose-950/60 border-rose-500/50 text-rose-300 line-through opacity-75 hover:opacity-100"
                      : "bg-emerald-950/50 border-emerald-500/40 text-emerald-200 hover:bg-emerald-900/60 shadow-sm"
                  }`}
                  title={isExcluded ? "클릭 시 퐁당퐁당 기여도 관리에 포함" : "클릭 시 퐁당퐁당 기여도 관리에서 제외"}
                >
                  <span className="text-xs font-bold">{isExcluded ? "✕" : "✓"}</span>
                  <span>{m.name}</span>
                  {role && <span className="text-[10px] opacity-75">({role})</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* 1. 멤버별 퐁당퐁당 엑셀표 실시간 현황 (Excel Grid) */}
        <div className="rounded-xl border border-white/15 bg-neutral-900/80 p-3 sm:p-4 shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm text-neutral-100 flex items-center gap-1.5">
                <span>📊</span> 퐁당퐁당 엑셀표 실시간 현황
              </span>
              <span className="text-xs text-neutral-400">
                (방송 화면의 퐁당퐁당 엑셀표 기여도 열에 즉시 반영)
              </span>
            </div>
            <div className="text-xs text-neutral-400 font-mono">
              판 전체 총합: <strong className={`font-black text-sm ${totals.finalSum < 0 ? "text-rose-400" : "text-amber-300"}`}>
                {formatAmount(totals.finalSum)}
              </strong>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-neutral-950/80 text-neutral-400 border-b border-white/10 select-none">
                  <th className="py-2 px-3 text-center w-12 font-semibold">순위</th>
                  <th className="py-2 px-3 font-semibold">멤버(직급)</th>
                  <th className="py-2 px-3 text-right font-semibold">자동 집계</th>
                  <th className="py-2 px-3 text-right font-semibold">수동 내역/보정</th>
                  <th className="py-2 px-3 text-right font-bold text-amber-200">최종 퐁당 기여도</th>
                  <th className="py-2 px-3 text-center font-semibold">빠른 가감</th>
                  <th className="py-2 px-3 text-right w-36 font-semibold">직접 보정값</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {memberSummaries.map((s, idx) => {
                  const isNeg = s.finalContribution < 0;
                  const rankBadge = idx === 0 ? "🥇 1위" : idx === 1 ? "🥈 2위" : idx === 2 ? "🥉 3위" : `${idx + 1}위`;
                  return (
                    <tr
                      key={`pongdang-row-${s.member.id}`}
                      className={`hover:bg-white/5 transition-colors ${
                        s.isOperating ? "opacity-60 bg-neutral-950/40" : idx % 2 === 1 ? "bg-white/[0.02]" : ""
                      }`}
                    >
                      <td className="py-2 px-3 text-center font-bold text-neutral-400 whitespace-nowrap">
                        {s.isOperating ? "-" : rankBadge}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap font-medium text-neutral-200">
                        <span>{s.member.name}</span>
                        {s.role && <span className="ml-1 text-[11px] text-neutral-400 font-normal">({s.role})</span>}
                        {s.isOperating && <span className="ml-1 text-[10px] text-amber-500/80 font-bold">[운영비]</span>}
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-neutral-300">
                        {s.autoVal < 0 ? (
                          <span className="text-rose-400 font-bold">{formatAmount(s.autoVal)}</span>
                        ) : (
                          formatAmount(s.autoVal)
                        )}
                      </td>
                      <td className="py-2 px-3 text-right font-mono">
                        {s.totalManual > 0 ? (
                          <span className="text-emerald-400 font-semibold">+{formatAmount(s.totalManual)}</span>
                        ) : s.totalManual < 0 ? (
                          <span className="text-rose-400 font-semibold">{formatAmount(s.totalManual)}</span>
                        ) : (
                          <span className="text-neutral-500">0</span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right font-mono">
                        <span className={`text-sm font-black tabular-nums ${
                          isNeg
                            ? "text-rose-400 drop-shadow-[0_0_8px_rgba(244,63,94,0.3)]"
                            : s.finalContribution > 0
                            ? "text-amber-200"
                            : "text-neutral-400"
                        }`}>
                          {formatAmount(s.finalContribution)}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            className="px-1.5 py-0.5 rounded bg-emerald-950/60 hover:bg-emerald-900 border border-emerald-500/30 text-emerald-200 text-[11px] font-semibold"
                            onClick={() => adjustDirectManual(s.member.id, 50000)}
                            title="+5만 추가"
                          >
                            +5만
                          </button>
                          <button
                            type="button"
                            className="px-1.5 py-0.5 rounded bg-emerald-950/60 hover:bg-emerald-900 border border-emerald-500/30 text-emerald-200 text-[11px] font-semibold"
                            onClick={() => adjustDirectManual(s.member.id, 10000)}
                            title="+1만 추가"
                          >
                            +1만
                          </button>
                          <button
                            type="button"
                            className="px-1.5 py-0.5 rounded bg-rose-950/60 hover:bg-rose-900 border border-rose-500/30 text-rose-200 text-[11px] font-semibold"
                            onClick={() => adjustDirectManual(s.member.id, -10000)}
                            title="-1만 차감 (마이너스)"
                          >
                            -1만
                          </button>
                          <button
                            type="button"
                            className="px-1.5 py-0.5 rounded bg-rose-950/60 hover:bg-rose-900 border border-rose-500/30 text-rose-200 text-[11px] font-semibold"
                            onClick={() => adjustDirectManual(s.member.id, -50000)}
                            title="-5만 차감 (마이너스)"
                          >
                            -5만
                          </button>
                          <button
                            type="button"
                            className="px-1.5 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-400 text-[11px]"
                            onClick={() => setDirectManual(s.member.id, 0)}
                            title="보정값 0원 리셋"
                          >
                            0원
                          </button>
                        </div>
                      </td>
                      <td className="py-2 px-3 text-right">
                        <input
                          type="number"
                          className="w-24 px-2 py-0.5 rounded bg-neutral-950 border border-white/20 text-xs text-right font-mono font-bold text-amber-200 focus:outline-none focus:border-amber-400"
                          value={s.directManualVal || ""}
                          placeholder="0 (+/-)"
                          onChange={(e) => {
                            const val = e.target.value.trim();
                            const num = val === "" ? 0 : parseInt(val, 10) || 0;
                            setDirectManual(s.member.id, num);
                          }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-neutral-950 font-bold border-t border-white/20 text-neutral-200">
                  <td colSpan={2} className="py-2 px-3 text-center text-amber-300">
                    합계 (TOTAL)
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-neutral-300">
                    {formatAmount(totals.autoSum)}
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-neutral-300">
                    {totals.manualSum > 0 ? `+${formatAmount(totals.manualSum)}` : formatAmount(totals.manualSum)}
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-base font-black text-amber-300">
                    {formatAmount(totals.finalSum)}
                  </td>
                  <td colSpan={2} className="py-2 px-3 text-right text-[11px] text-neutral-500 font-normal">
                    * 음수 기여도는 총합에서 자동으로 감산됩니다.
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* 2. 수동 기여도 추가 혹은 마이너스 처리 등록 폼 */}
        <div className="rounded-xl border border-white/15 bg-neutral-900/80 p-3 sm:p-4 shadow-xl">
          <div className="flex items-center gap-2 mb-3">
            <span className="font-bold text-sm text-neutral-100 flex items-center gap-1.5">
              <span>✍️</span> 수동 기여도 추가 / 마이너스(차감) 등록
            </span>
            <span className="text-xs text-neutral-400">
              (특정 멤버에게 후원자명과 함께 기여도를 추가하거나 마이너스로 등록)
            </span>
          </div>

          <form onSubmit={submitNewManualContribution} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-2.5 items-end">
            <div>
              <label className="block text-[11px] text-neutral-400 mb-1">대상 멤버</label>
              <select
                className="w-full px-2.5 py-1.5 rounded-lg bg-neutral-950 border border-white/20 text-xs font-semibold text-neutral-200 focus:outline-none focus:border-amber-400"
                value={participatingMembers.some((m) => m.id === newLogMemberId) ? newLogMemberId : (participatingMembers[0]?.id || "")}
                onChange={(e) => setNewLogMemberId(e.target.value)}
              >
                {participatingMembers.map((m) => (
                  <option key={`opt-m-${m.id}`} value={m.id}>
                    {m.name} {(memberPositions?.[m.id] ? `(${memberPositions[m.id]})` : "")}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-neutral-400 mb-1">후원자명 (선택)</label>
              <input
                type="text"
                className="w-full px-2.5 py-1.5 rounded-lg bg-neutral-950 border border-white/20 text-xs text-neutral-200 focus:outline-none focus:border-amber-400"
                placeholder="익명 / 관리자"
                value={newLogDonorName}
                onChange={(e) => setNewLogDonorName(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-[11px] text-neutral-400 mb-1">기여도 금액</label>
              <input
                type="number"
                className="w-full px-2.5 py-1.5 rounded-lg bg-neutral-950 border border-white/20 text-xs font-bold text-amber-200 focus:outline-none focus:border-amber-400"
                placeholder="50000"
                value={newLogAmount}
                onChange={(e) => setNewLogAmount(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-[11px] text-neutral-400 mb-1">구분</label>
              <div className="flex rounded-lg overflow-hidden border border-white/20">
                <button
                  type="button"
                  className={`flex-1 py-1.5 text-xs font-bold transition ${
                    !newLogIsMinus
                      ? "bg-emerald-600 text-white"
                      : "bg-neutral-900 text-neutral-400 hover:text-white"
                  }`}
                  onClick={() => setNewLogIsMinus(false)}
                >
                  + 추가
                </button>
                <button
                  type="button"
                  className={`flex-1 py-1.5 text-xs font-bold transition ${
                    newLogIsMinus
                      ? "bg-rose-600 text-white"
                      : "bg-neutral-900 text-neutral-400 hover:text-white"
                  }`}
                  onClick={() => setNewLogIsMinus(true)}
                >
                  - 마이너스
                </button>
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-neutral-400 mb-1">사유 / 메모</label>
              <input
                type="text"
                className="w-full px-2.5 py-1.5 rounded-lg bg-neutral-950 border border-white/20 text-xs text-neutral-200 focus:outline-none focus:border-amber-400"
                placeholder={newLogIsMinus ? "예: 미션 실패 벌금" : "예: 룰렛 보너스"}
                value={newLogNote}
                onChange={(e) => setNewLogNote(e.target.value)}
              />
            </div>

            <div>
              <button
                type="submit"
                className={`w-full py-1.5 px-3 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer shadow ${
                  newLogIsMinus
                    ? "bg-rose-600 hover:bg-rose-500 text-white shadow-rose-900/40"
                    : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/40"
                }`}
              >
                <span>{newLogIsMinus ? "⚠️" : "✓"}</span>
                {newLogIsMinus ? "마이너스 등록" : "기여도 등록"}
              </button>
            </div>
          </form>
        </div>

        {/* 3. 후원자 리스트 스타일 건별 기여도 내역 리스트 (해당 기여도에 대한 마이너스 처리) */}
        <div className="rounded-xl border border-white/15 bg-neutral-900/80 p-3 sm:p-4 shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div>
              <h2 className="font-bold text-sm text-neutral-100 flex items-center gap-2">
                <span>📋</span> 퐁당퐁당 건별 기여도 내역 리스트
                <span className="text-xs text-neutral-400 font-normal">
                  (총 {filteredRows.length}건)
                </span>
              </h2>
              <p className="text-xs text-neutral-400 mt-0.5">
                후원자 리스트처럼 각 후원/시그 기여도가 표시되며, <strong>[[-] 마이너스 처리]</strong> 버튼으로 즉시 해당 건을 마이너스(-) 처리하거나 다시 복원할 수 있습니다.
              </p>
            </div>

            {/* 필터 탭 */}
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: "all", label: "전체" },
                  { id: "auto", label: "자동 시그/후원" },
                  { id: "manual", label: "수동 등록" },
                  { id: "minus", label: "마이너스(-) 건만" },
                ] as const
              ).map((tab) => (
                <button
                  key={`ft-${tab.id}`}
                  type="button"
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    filterType === tab.id
                      ? "bg-amber-500 text-black font-bold"
                      : "bg-neutral-800 text-neutral-400 hover:text-white"
                  }`}
                  onClick={() => setFilterType(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* 검색 및 멤버 필터 바 */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <div className="relative flex-1 min-w-[200px]">
              <input
                type="text"
                className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-neutral-950 border border-white/15 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-amber-400"
                placeholder="후원자명, 멤버명, 사유 검색…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500 text-xs">🔍</span>
            </div>

            <div className="w-40">
              <select
                className="w-full px-2.5 py-1.5 rounded-lg bg-neutral-950 border border-white/15 text-xs text-neutral-200 focus:outline-none focus:border-amber-400"
                value={filterMemberId}
                onChange={(e) => setFilterMemberId(e.target.value)}
              >
                <option value="all">전체 참여 멤버 보기</option>
                {participatingMembers.map((m) => (
                  <option key={`f-m-${m.id}`} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 건별 리스트 테이블 */}
          <div className="overflow-x-auto rounded-lg border border-white/10 max-h-[500px] overflow-y-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="sticky top-0 z-10 bg-neutral-950 text-neutral-400 border-b border-white/10 select-none shadow">
                <tr>
                  <th className="py-2.5 px-3 w-20">시간</th>
                  <th className="py-2.5 px-3 font-semibold">후원자명</th>
                  <th className="py-2.5 px-3 font-semibold">대상 멤버</th>
                  <th className="py-2.5 px-3 font-semibold">유형 / 사유</th>
                  <th className="py-2.5 px-3 text-right font-bold">기여도 금액</th>
                  <th className="py-2.5 px-3 text-center w-24">상태</th>
                  <th className="py-2.5 px-3 text-center w-36">마이너스 처리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-neutral-500">
                      표시할 퐁당퐁당 기여도 내역이 없습니다.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((r) => {
                    return (
                      <tr
                        key={r.key}
                        className={`hover:bg-white/5 transition-colors ${
                          r.isMinus ? "bg-rose-950/20" : ""
                        }`}
                      >
                        <td className="py-2 px-3 text-neutral-400 font-mono text-[11px] whitespace-nowrap">
                          {formatTime(r.at)}
                        </td>
                        <td className="py-2 px-3 font-semibold text-neutral-200 whitespace-nowrap">
                          {r.donorName}
                        </td>
                        <td className="py-2 px-3 whitespace-nowrap">
                          {r.sourceType === "auto_sig" ? (
                            <div className="flex items-center gap-1.5">
                              <select
                                className={`px-2 py-0.5 rounded text-xs font-bold cursor-pointer transition ${
                                  r.isAutoAssigned
                                    ? "bg-amber-950/80 border border-amber-400 text-amber-200 animate-pulse"
                                    : "bg-neutral-900 border border-white/15 text-neutral-200 hover:border-white/30"
                                }`}
                                value={r.memberId}
                                onChange={(e) => {
                                  const newMid = e.target.value;
                                  if (newMid) void assignDonorMember(r.rawId, newMid);
                                }}
                              >
                                {r.isAutoAssigned ? (
                                  <option value="" disabled>
                                    ⚠️ 멤버 지정 필요 (선택)
                                  </option>
                                ) : null}
                                {participatingMembers.map((m) => (
                                  <option key={`sel-m-${m.id}`} value={m.id}>
                                    {m.name}
                                  </option>
                                ))}
                              </select>
                              {r.isAutoAssigned ? (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 whitespace-nowrap">
                                  미반영
                                </span>
                              ) : null}
                            </div>
                          ) : (
                            <span className="px-2 py-0.5 rounded bg-neutral-800 border border-white/10 font-bold text-neutral-300">
                              {r.memberName}
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-neutral-300">
                          <div className="flex items-center gap-1.5">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              r.sourceType === "auto_sig"
                                ? "bg-purple-950 text-purple-300 border border-purple-500/30"
                                : "bg-sky-950 text-sky-300 border border-sky-500/30"
                            }`}>
                              {r.sourceType === "auto_sig" ? "777 시그" : "수동 등록"}
                            </span>
                            <span className="truncate max-w-[240px] text-neutral-400">{r.reason}</span>
                          </div>
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold whitespace-nowrap">
                          {r.isMinus ? (
                            <span className="text-rose-400 text-sm font-black drop-shadow-[0_0_6px_rgba(244,63,94,0.4)]">
                              -{formatAmount(r.amount)}
                            </span>
                          ) : (
                            <span className="text-emerald-300 text-sm font-black">
                              +{formatAmount(r.amount)}
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-center whitespace-nowrap">
                          {r.isMinus ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-950/80 border border-rose-500/50 text-rose-300">
                              ⛔ 마이너스(-)
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950/80 border border-emerald-500/50 text-emerald-300">
                              ✓ 정상(+)
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              className={`px-2.5 py-1 rounded text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                                r.isMinus
                                  ? "bg-emerald-950 hover:bg-emerald-900 border border-emerald-500/50 text-emerald-200"
                                  : "bg-rose-950 hover:bg-rose-900 border border-rose-500/50 text-rose-200"
                              }`}
                              onClick={() => toggleRowMinus(r)}
                              title={r.isMinus ? "기여도를 다시 양수(+)로 복원" : "해당 기여도를 마이너스(-)로 차감 처리"}
                            >
                              <span>{r.isMinus ? "↺" : "−"}</span>
                              <span>{r.isMinus ? "정상 복원" : "마이너스 처리"}</span>
                            </button>
                            {r.sourceType === "manual_log" && (
                              <button
                                type="button"
                                className="px-1.5 py-1 rounded bg-neutral-800 hover:bg-rose-950 text-neutral-400 hover:text-rose-300 text-xs"
                                onClick={() => deleteManualLog(r.rawId)}
                                title="이 내역 삭제"
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminPopupShell>
  );
}
