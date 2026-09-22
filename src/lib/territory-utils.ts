import type { HighSocietyPushDir, HighSocietySettings, Member, TerritoryLog } from "@/types";
import {
  parseHighSocietyPushDir,
  pushDirToLeftRight,
  resolveSystemMiddlePushDir,
  seatExpandDirForIndex,
  seatRoleForMemberId,
} from "@/lib/high-society";

export function normalizeTerritoryLog(raw: unknown): TerritoryLog | null {
  if (!raw || typeof raw !== "object") return null;
  const x = raw as Record<string, unknown>;
  const memberId = String(x.memberId || "").trim();
  const teamId = typeof x.teamId === "string" && x.teamId.trim() ? x.teamId.trim() : undefined;
  if (!memberId && !teamId) return null;
  const amount = Math.max(0, Math.floor(Number(x.amount) || 0));
  const delta = x.delta === -1 ? -1 : 1;
  const pushRaw = String(x.pushDir || "").trim().toLowerCase();
  const pushDir: HighSocietyPushDir | undefined =
    pushRaw === "left" || pushRaw === "right" || pushRaw === "split" ? pushRaw : undefined;
  return {
    id: String(x.id || `tl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`),
    memberId: memberId || (teamId ? `__team_${teamId}` : ""),
    ...(teamId ? { teamId } : {}),
    amount,
    delta,
    ...(pushDir ? { pushDir } : {}),
    note: typeof x.note === "string" ? x.note.trim() : "",
    at: Number.isFinite(Number(x.at)) ? Math.floor(Number(x.at)) : Date.now(),
  };
}

export function normalizeTerritoryLogs(input: unknown): TerritoryLog[] {
  if (!Array.isArray(input)) return [];
  return input.map(normalizeTerritoryLog).filter((x): x is TerritoryLog => Boolean(x));
}

function unionTerritoryLogsById(
  base: TerritoryLog[],
  patch: TerritoryLog[],
  opts?: { dropStalePatchOnlyBefore?: number }
): TerritoryLog[] {
  const byId = new Map<string, TerritoryLog>();
  for (const log of base) byId.set(String(log.id), log);
  const cutoff = Number(opts?.dropStalePatchOnlyBefore || 0);
  for (const log of patch) {
    const id = String(log.id);
    const prev = byId.get(id);
    if (prev) {
      if (Number(log.at || 0) >= Number(prev.at || 0)) byId.set(id, log);
      continue;
    }
    /** 삭제된 id 가 늦은 debounce PATCH 로 되살아나지 않게 — 기록 시각이 베이스보다 옛것이면 무시 */
    if (cutoff > 0 && Number(log.at || 0) + 2_000 < cutoff) continue;
    byId.set(id, log);
  }
  return [...byId.values()].sort((a, b) => Number(a.at || 0) - Number(b.at || 0));
}

export function mergeDeletedTerritoryLogIds(
  a?: string[] | null,
  b?: string[] | null
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...(a || []), ...(b || [])]) {
    const id = String(raw || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out.slice(-80);
}

function dropDeletedTerritoryLogs(
  logs: TerritoryLog[],
  deletedIds?: string[] | null
): TerritoryLog[] {
  const drop = new Set((deletedIds || []).map((id) => String(id || "").trim()).filter(Boolean));
  if (drop.size === 0) return logs;
  return logs.filter((l) => !drop.has(String(l.id)));
}

/**
 * PATCH territoryLogs 병합.
 * 기본은 id union (연속 입력 3건이 2건 POST 로 덮이지 않게).
 * 한 건 삭제는 patch 가 base 보다 최신일 때만 (기록 한 줄 삭제).
 * 여러 줄을 한 번에 짧은 목록으로 덮으면 나머지가 통째로 사라지므로 union + deletedIds 만 제거.
 */
export function mergeTerritoryLogsFromPatch(
  baseLogs: TerritoryLog[] | undefined,
  patchLogs: TerritoryLog[] | undefined,
  opts?: { baseUpdatedAt?: number; patchUpdatedAt?: number; deletedIds?: string[] }
): TerritoryLog[] {
  const base = normalizeTerritoryLogs(baseLogs);
  const patch = normalizeTerritoryLogs(patchLogs);
  const patchAt = Number(opts?.patchUpdatedAt || 0);
  const baseAt = Number(opts?.baseUpdatedAt || 0);
  const patchIsNewer = patchAt <= 0 || baseAt <= 0 || patchAt >= baseAt;
  const deletedIds = opts?.deletedIds;
  /** 영토만 초기화 — 명시적 빈 목록. 오래된 [] POST 는 최신(리셋 이후) 기록을 지우지 않음. */
  if (Array.isArray(patchLogs) && patch.length === 0) {
    if (patchIsNewer) return [];
    if (patchAt > 0 && base.every((l) => Number(l.at || 0) < patchAt)) return [];
    return dropDeletedTerritoryLogs(base, deletedIds);
  }
  /** 리셋으로 비운 뒤 늦게 도착한 옛 기록 POST 는 타임스탬프가 더 커도 되살리지 않음 */
  if (
    base.length === 0 &&
    Array.isArray(baseLogs) &&
    baseAt > 0 &&
    patch.length > 0 &&
    patch.every((l) => Number(l.at || 0) + 2_000 < baseAt)
  ) {
    return [];
  }
  const patchIds = new Set(patch.map((l) => String(l.id)));
  const baseIds = new Set(base.map((l) => String(l.id)));
  const isSingleDeletion =
    patch.length === base.length - 1 &&
    patch.length < base.length &&
    [...patchIds].every((id) => baseIds.has(id));
  if (isSingleDeletion && patchIsNewer) {
    return dropDeletedTerritoryLogs(patch, deletedIds);
  }
  return dropDeletedTerritoryLogs(
    unionTerritoryLogsById(base, patch, {
      dropStalePatchOnlyBefore: patchIsNewer ? baseAt : 0,
    }),
    deletedIds
  );
}

/** 「영토만 초기화」 시각 이전 기록은 계산·표시에서 제외 */
export function filterTerritoryLogsAfterReset(
  logs: TerritoryLog[] | undefined,
  resetAt?: number
): TerritoryLog[] {
  const all = normalizeTerritoryLogs(logs);
  const cutoff = Number(resetAt || 0);
  if (!(cutoff > 0)) return all;
  return all.filter((l) => Number(l.at || 0) >= cutoff);
}

/** 로컬·원격 영토 기록부 — 삭제(부분집합)는 더 최신 쪽 정본, 아니면 id union */
export function mergeTerritoryLogsPreferFresher(
  local: TerritoryLog[] | undefined,
  remote: TerritoryLog[] | undefined,
  opts?: {
    localUpdatedAt?: number;
    remoteUpdatedAt?: number;
    territoryLogsResetAt?: number;
    deletedIds?: string[];
  }
): TerritoryLog[] {
  const loc = normalizeTerritoryLogs(local);
  const rem = normalizeTerritoryLogs(remote);
  const localAt = Number(opts?.localUpdatedAt || 0);
  const remoteAt = Number(opts?.remoteUpdatedAt || 0);
  const keepOnOrAfter = (logs: TerritoryLog[], cutoff: number) => {
    const t = Number(cutoff || 0);
    if (!(t > 0)) return logs;
    return logs.filter((l) => Number(l.at || 0) >= t);
  };
  let result: TerritoryLog[];
  /** 영토만 초기화 [] — 상대 쪽 기록이 모두 리셋 시각 이전이면 되살리지 않음 */
  if (loc.length === 0 && localAt > 0) {
    const kept = keepOnOrAfter(rem, localAt);
    result = localAt >= remoteAt || kept.length === 0 ? loc : kept;
  } else if (rem.length === 0 && remoteAt > 0) {
    const kept = keepOnOrAfter(loc, remoteAt);
    result = remoteAt >= localAt || kept.length === 0 ? rem : kept;
  } else if (loc.length === rem.length - 1 && localAt >= remoteAt) {
    const remIds = new Set(rem.map((l) => String(l.id)));
    const locIds = new Set(loc.map((l) => String(l.id)));
    result = [...locIds].every((id) => remIds.has(id))
      ? loc
      : unionTerritoryLogsById(rem, loc);
  } else if (rem.length === loc.length - 1 && remoteAt >= localAt) {
    const locIds = new Set(loc.map((l) => String(l.id)));
    const remIds = new Set(rem.map((l) => String(l.id)));
    result = [...remIds].every((id) => locIds.has(id))
      ? rem
      : unionTerritoryLogsById(rem, loc);
  } else {
    result = unionTerritoryLogsById(rem, loc);
  }
  result = dropDeletedTerritoryLogs(result, opts?.deletedIds);
  return filterTerritoryLogsAfterReset(result, opts?.territoryLogsResetAt);
}

export function createTerritoryLog(
  memberId: string,
  delta: 1 | -1,
  amountCm: number,
  opts?: { pushDir?: HighSocietyPushDir; note?: string; now?: number; teamId?: string }
): TerritoryLog {
  const now = opts?.now ?? Date.now();
  const amount = Math.max(0, Math.floor(amountCm));
  const teamId = typeof opts?.teamId === "string" && opts.teamId.trim() ? opts.teamId.trim() : undefined;
  return {
    id: `tl_${now}_${Math.random().toString(36).slice(2, 10)}`,
    memberId: teamId ? `__team_${teamId}` : memberId,
    ...(teamId ? { teamId } : {}),
    amount,
    delta,
    ...(opts?.pushDir ? { pushDir: opts.pushDir } : {}),
    note: String(opts?.note || "").trim(),
    at: now,
  };
}

/** 영토 기록 저장 시 pushDir — 양끝 좌석은 고정 방향, 가운데는 선택·시스템 기본 */
export function resolveTerritoryLogPushDirForWrite(args: {
  seatRole: { canChoosePush: boolean; expandDir: "left" | "right" | "both" } | null;
  chosen: "system" | HighSocietyPushDir;
  settings: HighSocietySettings;
}): HighSocietyPushDir | undefined {
  const { seatRole, chosen, settings } = args;
  if (!seatRole) return undefined;
  if (seatRole.canChoosePush) {
    if (chosen === "left" || chosen === "right" || chosen === "split") return chosen;
    return resolveSystemMiddlePushDir(settings);
  }
  if (seatRole.expandDir === "left") return "left";
  if (seatRole.expandDir === "right") return "right";
  return undefined;
}

/** 기록부 표 — 저장값 없어도 좌석 규칙·시스템 기본으로 방향 표시 */
export function formatTerritoryLogPushDirLabel(
  log: TerritoryLog,
  settings: HighSocietySettings,
  members: Array<Pick<Member, "id" | "name" | "account" | "toon" | "operating">>
): string {
  const stored = parseHighSocietyPushDir(log.pushDir);
  const role = seatRoleForMemberId(settings, members, log.memberId);
  const effective: HighSocietyPushDir | null =
    stored ||
    (role && !role.canChoosePush
      ? role.expandDir === "left"
        ? "left"
        : role.expandDir === "right"
          ? "right"
          : null
      : null) ||
    (role?.canChoosePush ? resolveSystemMiddlePushDir(settings) : null);
  if (effective === "left") return "← 왼쪽";
  if (effective === "right") return "→ 오른쪽";
  if (effective === "split") return "↔ 양분";
  return "—";
}

/** 기록부 로그 → 좌석별 expandLeft/Right cm (후원·자동 연동과 분리) */
export function aggregateSeatPushesFromTerritoryLogs(opts: {
  seatPlayers: Array<{ id: string; name: string }>;
  logs: TerritoryLog[];
  settings: HighSocietySettings;
}): Array<{
  id: string;
  name: string;
  donationWon: number;
  expandLeftCm: number;
  expandRightCm: number;
}> {
  const { seatPlayers, logs, settings } = opts;
  const n = seatPlayers.length;
  const middleDir = resolveSystemMiddlePushDir(settings);
  const netByMember = new Map<string, { left: number; right: number }>();

  for (const log of logs || []) {
    const memberId = String(log.memberId || "").trim();
    if (!memberId) continue;
    const cm = Math.max(0, Math.floor(Number(log.amount) || 0));
    if (cm <= 0) continue;
    const signed = log.delta === -1 ? -cm : cm;
    const seatIndex = seatPlayers.findIndex((p) => p.id === memberId);
    if (seatIndex < 0) continue;
    const dir = seatExpandDirForIndex(seatIndex, n);
    const prev = netByMember.get(memberId) || { left: 0, right: 0 };
    if (dir === "right") {
      netByMember.set(memberId, { left: prev.left, right: prev.right + signed });
      continue;
    }
    if (dir === "left") {
      netByMember.set(memberId, { left: prev.left + signed, right: prev.right });
      continue;
    }
    const push = parseHighSocietyPushDir(log.pushDir) || middleDir;
    const lr = pushDirToLeftRight(Math.abs(signed), push);
    const sign = signed < 0 ? -1 : 1;
    netByMember.set(memberId, {
      left: prev.left + lr.left * sign,
      right: prev.right + lr.right * sign,
    });
  }

  return seatPlayers.map((player) => {
    const net = netByMember.get(player.id) || { left: 0, right: 0 };
    return {
      id: player.id,
      name: player.name,
      donationWon: 0,
      expandLeftCm: net.left,
      expandRightCm: net.right,
    };
  });
}

export function mergeHighSocietyPlayerPushInputs(
  base: Array<{
    id: string;
    name: string;
    donationWon?: number;
    expandLeftCm?: number;
    expandRightCm?: number;
  }>,
  extra: Array<{
    id: string;
    name: string;
    donationWon?: number;
    expandLeftCm?: number;
    expandRightCm?: number;
  }>
): Array<{
  id: string;
  name: string;
  donationWon: number;
  expandLeftCm?: number;
  expandRightCm?: number;
}> {
  const byId = new Map(base.map((p) => [p.id, { ...p }]));
  for (const e of extra) {
    const b = byId.get(e.id);
    if (!b) {
      byId.set(e.id, { ...e });
      continue;
    }
    byId.set(e.id, {
      ...b,
      donationWon: Math.max(0, Number(b.donationWon) || 0) + Math.max(0, Number(e.donationWon) || 0),
      expandLeftCm: (Number(b.expandLeftCm) || 0) + (Number(e.expandLeftCm) || 0),
      expandRightCm: (Number(b.expandRightCm) || 0) + (Number(e.expandRightCm) || 0),
    });
  }
  return base.map((p) => {
    const row = byId.get(p.id)!;
    return {
      ...row,
      donationWon: Math.max(0, Number(row.donationWon) || 0),
    };
  });
}
