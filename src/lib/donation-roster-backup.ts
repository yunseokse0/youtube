import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import type { AppState, Donor, Member } from "@/types";
import {
  upstashGetAppStateJson,
  upstashSetAppStateJson,
} from "@/app/api/_shared/upstash-app-state";
import { getSigUploadPersistentDataDir } from "@/lib/sig-upload-storage";
import {
  isDefaultPlaceholderMemberList,
  normalizeDonorsArray,
  totalCombined,
} from "@/lib/state";
import { syncMemberTotalsFromDonors } from "@/lib/donation/apply-donation-state";

const STORAGE_KEY_BASE = "excel-broadcast-donation-roster-v1";

export function donationRosterBackupKey(userId: string): string {
  return `${STORAGE_KEY_BASE}:${userId}`;
}

export type DonationRosterBackupPayload = {
  members: Member[];
  donors: Donor[];
  memberPositions?: AppState["memberPositions"];
  settlementResetAt?: number;
  savedAt: number;
  total: number;
  donorsCount: number;
};

function donationDiskDir(): string {
  const persistent = getSigUploadPersistentDataDir();
  const root = persistent || path.join(process.cwd(), ".data");
  return path.join(root, "donation-roster");
}

function donationDiskPath(userId: string): string {
  const safe = String(userId || "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "default";
  return path.join(donationDiskDir(), `${safe}.json`);
}

export function buildDonationRosterBackupPayload(state: AppState): DonationRosterBackupPayload | null {
  const donors = normalizeDonorsArray(state.donors);
  const total = totalCombined(state);
  if (donors.length === 0 && total <= 0) return null;
  return {
    members: Array.isArray(state.members) ? state.members : [],
    donors,
    memberPositions: state.memberPositions,
    settlementResetAt: state.settlementResetAt,
    savedAt: Date.now(),
    total,
    donorsCount: donors.length,
  };
}

/** 메인 상태가 비거나 줄었을 때 백업에서 후원·금액을 되살릴지 */
export function shouldRestoreDonationRosterFromBackup(
  current: Pick<AppState, "members" | "donors" | "settlementResetAt"> | null | undefined,
  backup: DonationRosterBackupPayload | null | undefined
): boolean {
  if (!backup) return false;
  if (backup.donorsCount <= 0 && backup.total <= 0) return false;
  const curDonors = normalizeDonorsArray(current?.donors);
  const curTotal = current ? totalCombined(current as AppState) : 0;
  const curReset = Number(current?.settlementResetAt || 0);
  const backupReset = Number(backup.settlementResetAt || 0);
  const placeholderMembers = isDefaultPlaceholderMemberList(current?.members);
  /**
   * 멤버1·2·3 플레이스홀더 + 빈 후원 = 사고성 초기화(정상 정산 리셋은 실멤버명 유지).
   * settlementResetAt 이 앞서 있어도 백업에서 되살린다.
   */
  if (placeholderMembers && curDonors.length === 0 && backup.donorsCount > 0) {
    return true;
  }
  if (placeholderMembers && curTotal === 0 && backup.total > 0) {
    return true;
  }
  /**
   * 정산 리셋 이후에는 백업이 더 풍부해 보여도 되살리지 않음.
   * (리셋 직후 소액 후원만 있을 때 구 백업이 donorsCount/total 로 이기는 회귀 방지)
   */
  if (curReset > backupReset) {
    return false;
  }
  /**
   * 완전 비었을 때만 복구. 부분 삭제(shrink)는 정상 동작이므로
   * backup.donorsCount > curDonors.length 이면 되살리지 않음.
   */
  if (curDonors.length === 0 && backup.donorsCount > 0) return true;
  if (curTotal === 0 && backup.total > 0) return true;
  return false;
}

export function applyDonationRosterBackupToState(
  state: AppState,
  backup: DonationRosterBackupPayload
): AppState {
  const curDonors = normalizeDonorsArray(state.donors);
  const placeholderWipe =
    isDefaultPlaceholderMemberList(state.members) &&
    curDonors.length === 0 &&
    totalCombined(state) === 0;
  /**
   * 사고성 플레이스홀더 초기화면 빈 상태의 높은 settlementResetAt 로
   * 백업 후원을 전부 필터링하지 않음 — 백업 stamp 기준으로 복구.
   */
  const resetAt = placeholderWipe
    ? Number(backup.settlementResetAt || 0)
    : Number(state.settlementResetAt || backup.settlementResetAt || 0);
  const rawDonors = normalizeDonorsArray(backup.donors);
  const donors =
    resetAt > 0
      ? rawDonors.filter((d) => (d.at || 0) >= resetAt - 3000)
      : rawDonors;
  const merged: AppState = {
    ...state,
    members: backup.members.length > 0 ? backup.members : state.members,
    donors,
    memberPositions: backup.memberPositions ?? state.memberPositions,
    settlementResetAt: placeholderWipe
      ? backup.settlementResetAt
      : state.settlementResetAt ?? backup.settlementResetAt,
    updatedAt: Math.max(Number(state.updatedAt || 0), Number(backup.savedAt || 0), Date.now()),
  };
  return syncMemberTotalsFromDonors(merged);
}

async function loadDonationRosterFromDisk(userId: string): Promise<DonationRosterBackupPayload | null> {
  try {
    const raw = await readFile(donationDiskPath(userId), "utf8");
    const parsed = JSON.parse(raw) as DonationRosterBackupPayload;
    if (!parsed || typeof parsed !== "object") return null;
    const donors = normalizeDonorsArray(parsed.donors);
    const total = Math.max(0, Number(parsed.total) || 0);
    if (donors.length === 0 && total <= 0) return null;
    return {
      ...parsed,
      donors,
      members: Array.isArray(parsed.members) ? parsed.members : [],
      total: total || totalCombined({ members: parsed.members || [], donors } as AppState),
      donorsCount: donors.length,
      savedAt: Number(parsed.savedAt) || 0,
    };
  } catch {
    return null;
  }
}

async function saveDonationRosterToDisk(
  userId: string,
  payload: DonationRosterBackupPayload
): Promise<boolean> {
  try {
    await mkdir(donationDiskDir(), { recursive: true });
    await writeFile(donationDiskPath(userId), JSON.stringify(payload), "utf8");
    return true;
  } catch {
    return false;
  }
}

export async function loadDonationRosterBackup(
  userId: string
): Promise<DonationRosterBackupPayload | null> {
  const fromRedis = await upstashGetAppStateJson<DonationRosterBackupPayload>(
    donationRosterBackupKey(userId)
  );
  const redisOk =
    fromRedis &&
    (normalizeDonorsArray(fromRedis.donors).length > 0 || Number(fromRedis.total) > 0)
      ? {
          ...fromRedis,
          donors: normalizeDonorsArray(fromRedis.donors),
          members: Array.isArray(fromRedis.members) ? fromRedis.members : [],
          donorsCount: normalizeDonorsArray(fromRedis.donors).length,
          total: Math.max(0, Number(fromRedis.total) || 0),
        }
      : null;
  const fromDisk = await loadDonationRosterFromDisk(userId);
  if (!redisOk) return fromDisk;
  if (!fromDisk) return redisOk;
  const redisReset = Number(redisOk.settlementResetAt || 0);
  const diskReset = Number(fromDisk.settlementResetAt || 0);
  /** 정산 리셋으로 비운 백업이 있으면 구(풍부) 백업보다 우선 */
  if (redisReset > diskReset && redisOk.donorsCount === 0 && redisOk.total <= 0) {
    return redisOk;
  }
  if (diskReset > redisReset && fromDisk.donorsCount === 0 && fromDisk.total <= 0) {
    return fromDisk;
  }
  /** 더 풍부·최신 백업 우선 */
  if (fromDisk.donorsCount > redisOk.donorsCount || fromDisk.total > redisOk.total) {
    return fromDisk.savedAt >= redisOk.savedAt - 5_000 ? fromDisk : redisOk;
  }
  if (fromDisk.savedAt > redisOk.savedAt && fromDisk.total >= redisOk.total) return fromDisk;
  return redisOk;
}

export async function saveDonationRosterBackup(userId: string, state: AppState): Promise<boolean> {
  const payload = buildDonationRosterBackupPayload(state);
  if (!payload) return false;
  const redisOk = await upstashSetAppStateJson(donationRosterBackupKey(userId), payload);
  const diskOk = await saveDonationRosterToDisk(userId, payload);
  return redisOk || diskOk;
}

/** 정산 리셋·후원 전체 삭제 후 빈 백업으로 덮어 되살림 방지 */
export async function clearDonationRosterBackup(
  userId: string,
  settlementResetAt?: number
): Promise<void> {
  const payload: DonationRosterBackupPayload = {
    members: [],
    donors: [],
    settlementResetAt,
    savedAt: Date.now(),
    total: 0,
    donorsCount: 0,
  };
  await upstashSetAppStateJson(donationRosterBackupKey(userId), payload);
  await saveDonationRosterToDisk(userId, payload);
}

export async function enrichAppStateWithDonationRosterBackup(
  userId: string,
  state: AppState
): Promise<{ state: AppState; restoredFromBackup: boolean }> {
  const backup = await loadDonationRosterBackup(userId);
  if (backup && shouldRestoreDonationRosterFromBackup(state, backup)) {
    return {
      state: applyDonationRosterBackupToState(state, backup),
      restoredFromBackup: true,
    };
  }
  if (buildDonationRosterBackupPayload(state)) {
    void saveDonationRosterBackup(userId, state);
  }
  return { state, restoredFromBackup: false };
}
