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
  if (!memberId) return null;
  const amount = Math.max(0, Math.floor(Number(x.amount) || 0));
  const delta = x.delta === -1 ? -1 : 1;
  const pushRaw = String(x.pushDir || "").trim().toLowerCase();
  const pushDir: HighSocietyPushDir | undefined =
    pushRaw === "left" || pushRaw === "right" || pushRaw === "split" ? pushRaw : undefined;
  return {
    id: String(x.id || `tl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`),
    memberId,
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

export function createTerritoryLog(
  memberId: string,
  delta: 1 | -1,
  amountCm: number,
  opts?: { pushDir?: HighSocietyPushDir; note?: string; now?: number }
): TerritoryLog {
  const now = opts?.now ?? Date.now();
  const amount = Math.max(0, Math.floor(amountCm));
  return {
    id: `tl_${now}_${Math.random().toString(36).slice(2, 6)}`,
    memberId,
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
