import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import type { AppState } from "@/types";
import {
  upstashGetAppStateJson,
  upstashSetAppStateJson,
} from "@/app/api/_shared/upstash-app-state";
import { getSigUploadPersistentDataDir } from "@/lib/sig-upload-storage";
import { normalizeDonorsArray, totalCombined } from "@/lib/state";
import {
  applyDonationRosterBackupToState,
  buildDonationRosterBackupPayload,
  donationRosterBackupKey,
  enrichAppStateWithDonationRosterBackupPayload,
  normalizeDonationRosterBackupPayload,
  shouldRestoreDonationRosterFromBackup,
  type DonationRosterBackupPayload,
} from "@/lib/donation-roster-backup-core";

export {
  applyDonationRosterBackupToState,
  buildDonationRosterBackupPayload,
  donationRosterBackupKey,
  shouldRestoreDonationRosterFromBackup,
  unionAppStateDonorsFromBackupIfRicher,
  type DonationRosterBackupPayload,
} from "@/lib/donation-roster-backup-core";

function donationDiskDir(): string {
  const persistent = getSigUploadPersistentDataDir();
  const root = persistent || path.join(process.cwd(), ".data");
  return path.join(root, "donation-roster");
}

function donationDiskPath(userId: string): string {
  const safe = String(userId || "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "default";
  return path.join(donationDiskDir(), `${safe}.json`);
}

async function loadDonationRosterFromDisk(userId: string): Promise<DonationRosterBackupPayload | null> {
  try {
    const raw = await readFile(donationDiskPath(userId), "utf8");
    const parsed = JSON.parse(raw) as DonationRosterBackupPayload;
    return normalizeDonationRosterBackupPayload(parsed);
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
  const redisOk = normalizeDonationRosterBackupPayload(
    await upstashGetAppStateJson<DonationRosterBackupPayload>(donationRosterBackupKey(userId))
  );
  const fromDisk = await loadDonationRosterFromDisk(userId);
  if (!redisOk) return fromDisk;
  if (!fromDisk) return redisOk;
  const redisReset = Number(redisOk.settlementResetAt || 0);
  const diskReset = Number(fromDisk.settlementResetAt || 0);
  if (redisReset > diskReset && redisOk.donorsCount === 0 && redisOk.total <= 0) {
    return redisOk;
  }
  if (diskReset > redisReset && fromDisk.donorsCount === 0 && fromDisk.total <= 0) {
    return fromDisk;
  }
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
  state: AppState,
  opts?: { persistBackup?: boolean }
): Promise<{ state: AppState; restoredFromBackup: boolean }> {
  const donors = normalizeDonorsArray(state.donors);
  const total = totalCombined(state);
  /** 메인 상태에 후원이 있으면 GET마다 Redis+디스크 백업을 읽지 않음 (연결 지연 완화) */
  if (donors.length > 0 && total > 0) {
    if (opts?.persistBackup !== false && buildDonationRosterBackupPayload(state)) {
      maybePersistDonationRosterBackup(userId, state);
    }
    return { state, restoredFromBackup: false };
  }
  const backup = await loadDonationRosterBackup(userId);
  const enriched = enrichAppStateWithDonationRosterBackupPayload(state, backup);
  if (enriched.restoredFromBackup) return enriched;
  if (opts?.persistBackup !== false && buildDonationRosterBackupPayload(state)) {
    maybePersistDonationRosterBackup(userId, state);
  }
  return enriched;
}

const lastDonationBackupPersistAt = new Map<string, number>();
const DONATION_BACKUP_PERSIST_MIN_MS = 60_000;

function maybePersistDonationRosterBackup(userId: string, state: AppState): void {
  const now = Date.now();
  const prev = lastDonationBackupPersistAt.get(userId) || 0;
  if (now - prev < DONATION_BACKUP_PERSIST_MIN_MS) return;
  lastDonationBackupPersistAt.set(userId, now);
  void saveDonationRosterBackup(userId, state);
}
