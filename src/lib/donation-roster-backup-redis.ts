import { upstashGetAppStateJson } from "@/app/api/_shared/upstash-app-state";
import type { AppState } from "@/types";
import {
  donationRosterBackupKey,
  enrichAppStateWithDonationRosterBackupPayload,
  normalizeDonationRosterBackupPayload,
  type DonationRosterBackupPayload,
} from "@/lib/donation-roster-backup-core";

/** Edge·instrumentation 안전 — Redis/MySQL KV 백업만 (디스크 fallback 없음) */
export async function loadDonationRosterBackupFromKv(
  userId: string
): Promise<DonationRosterBackupPayload | null> {
  const fromKv = await upstashGetAppStateJson<DonationRosterBackupPayload>(
    donationRosterBackupKey(userId)
  );
  return normalizeDonationRosterBackupPayload(fromKv);
}

export async function enrichAppStateWithDonationRosterBackupFromKv(
  userId: string,
  state: AppState
): Promise<{ state: AppState; restoredFromBackup: boolean }> {
  const backup = await loadDonationRosterBackupFromKv(userId);
  return enrichAppStateWithDonationRosterBackupPayload(state, backup);
}
