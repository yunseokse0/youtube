import type { Member } from "@/types";
import { isDefaultPlaceholderMemberList, membersDifferByIds } from "@/lib/state";
import { normalizeRestroomCount } from "@/lib/restroom-utils";

/** 계좌·투네 0 리셋 차단 시에도 이름·목표·운영비·화장실·수동 기여도는 patch 반영.
 * patch 에만 있는 멤버(추가)는 맨 뒤에 붙인다 — base 만 map 하면 추가가 유실됨.
 * 단 placeholder(멤버1…) patch 는 추가하지 않음(테마 저장이 실로스터에 슬롯을 붙이지 않게). */
export function mergeManualMemberFieldsFromPatch(
  baseMembers: Member[],
  patchMembers: Member[]
): Member[] {
  const patchById = new Map(patchMembers.map((m) => [m.id, m]));
  const baseIds = new Set((baseMembers || []).map((m) => m.id));
  const merged = (baseMembers || []).map((baseM) => {
    const patchM = patchById.get(baseM.id);
    if (!patchM) return baseM;
    const patchName = String(patchM.name ?? "").trim();
    const baseName = String(baseM.name ?? "").trim();
    /** 플레이스홀더(멤버N)로 실멤버명을 덮지 않음 */
    const placeholderPatch =
      !patchName ||
      /^멤버\d+$/.test(patchName) ||
      (baseM.id && /^m(\d+)$/.test(baseM.id) && patchName === `멤버${baseM.id.slice(1)}`);
    const nextName = placeholderPatch && baseName ? baseName : patchName || baseName;
    return {
      ...baseM,
      name: nextName || baseM.name,
      goal:
        typeof patchM.goal === "number" && Number.isFinite(patchM.goal)
          ? Math.max(0, Math.floor(patchM.goal)) || undefined
          : patchM.goal === undefined
            ? baseM.goal
            : undefined,
      operating: Boolean(patchM.operating),
      restroom: normalizeRestroomCount(patchM.restroom),
      contribution:
        typeof patchM.contribution === "number" && Number.isFinite(patchM.contribution)
          ? Math.max(0, Math.floor(patchM.contribution))
          : baseM.contribution,
    };
  });
  if (!isDefaultPlaceholderMemberList(patchMembers)) {
    for (const pm of patchMembers || []) {
      if (!baseIds.has(pm.id)) merged.push(pm);
    }
  }
  return merged;
}

/** patch 로스터(순서·id)를 따르되, patch 금액이 0이면 base 금액을 유지 */
export function mergeMemberRosterPreservingAmounts(
  baseMembers: Member[],
  patchMembers: Member[]
): Member[] {
  const baseById = new Map((baseMembers || []).map((m) => [m.id, m]));
  return (patchMembers || []).map((patchM) => {
    const baseM = baseById.get(patchM.id);
    if (!baseM) return patchM;
    const patchAccount = Math.max(0, Number(patchM.account || 0));
    const patchToon = Math.max(0, Number(patchM.toon || 0));
    const baseAccount = Math.max(0, Number(baseM.account || 0));
    const baseToon = Math.max(0, Number(baseM.toon || 0));
    const patchEmpty = patchAccount + patchToon === 0;
    const baseHasAmt = baseAccount + baseToon > 0;
    const patchName = String(patchM.name ?? "").trim();
    const baseName = String(baseM.name ?? "").trim();
    const placeholderPatch =
      !patchName ||
      /^멤버\d+$/.test(patchName) ||
      (baseM.id && /^m(\d+)$/.test(baseM.id) && patchName === `멤버${baseM.id.slice(1)}`);
    const nextName = placeholderPatch && baseName ? baseName : patchName || baseName;
    return {
      ...baseM,
      ...patchM,
      name: nextName || baseM.name,
      account: patchEmpty && baseHasAmt ? baseAccount : patchAccount,
      toon: patchEmpty && baseHasAmt ? baseToon : patchToon,
      restroom: normalizeRestroomCount(
        patchM.restroom !== undefined ? patchM.restroom : baseM.restroom
      ),
      contribution:
        typeof patchM.contribution === "number" && Number.isFinite(patchM.contribution)
          ? Math.max(0, Math.floor(patchM.contribution))
          : baseM.contribution,
      operating: Boolean(patchM.operating),
    };
  });
}

/**
 * base에 금액이 있고 patch 멤버 금액이 전부 0일 때 —
 * 동일 로스터면 금액 wipe 차단, 멤버 추가·삭제(id 집합 변경)면 로스터는 수용하고 금액만 보존.
 */
export function resolveMembersAgainstZeroWipe(opts: {
  baseMembers: Member[];
  patchMembers: Member[];
}): { members: Member[]; blockedWipe: boolean; rosterChanged: boolean } {
  const baseMembers = opts.baseMembers || [];
  const patchMembers = opts.patchMembers || [];
  const baseHasAmt = baseMembers.some((m) => (m.account || 0) + (m.toon || 0) > 0);
  const patchAllZero = patchMembers.every((m) => (m.account || 0) + (m.toon || 0) === 0);
  if (!baseHasAmt || !patchAllZero || patchMembers.length === 0) {
    return { members: patchMembers, blockedWipe: false, rosterChanged: false };
  }
  const rosterChanged =
    membersDifferByIds(baseMembers, patchMembers) ||
    patchMembers.length !== baseMembers.length;
  if (rosterChanged) {
    return {
      members: mergeMemberRosterPreservingAmounts(baseMembers, patchMembers),
      blockedWipe: true,
      rosterChanged: true,
    };
  }
  return {
    members: mergeManualMemberFieldsFromPatch(baseMembers, patchMembers),
    blockedWipe: true,
    rosterChanged: false,
  };
}
