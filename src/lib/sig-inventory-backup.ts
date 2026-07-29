import type { SigItem } from "@/types";
import { normalizeSigInventory } from "@/lib/constants";
import {
  upstashGetAppStateJson,
  upstashSetAppStateJson,
} from "@/app/api/_shared/upstash-app-state";
import { hasExpandedSigInventory, isShrunkToDefaultSigInventory } from "@/lib/state";

const STORAGE_KEY_BASE = "excel-broadcast-sig-inventory-v1";

export function sigInventoryBackupKey(userId: string): string {
  return `${STORAGE_KEY_BASE}:${userId}`;
}

export type SigInventoryBackupPayload = {
  items: SigItem[];
  savedAt: number;
  count: number;
};

export async function loadSigInventoryBackup(userId: string): Promise<SigItem[] | null> {
  const data = await upstashGetAppStateJson<SigInventoryBackupPayload>(sigInventoryBackupKey(userId));
  if (!data || !Array.isArray(data.items) || data.items.length === 0) return null;
  return normalizeSigInventory(data.items);
}

export async function saveSigInventoryBackup(userId: string, items: SigItem[]): Promise<boolean> {
  const normalized = normalizeSigInventory(items);
  if (normalized.length === 0) return false;
  const payload: SigInventoryBackupPayload = {
    items: normalized,
    savedAt: Date.now(),
    count: normalized.length,
  };
  return upstashSetAppStateJson(sigInventoryBackupKey(userId), payload);
}

/** 메인 상태가 줄었을 때 백업 키에서 복구할지 */
export function shouldRestoreSigInventoryFromBackup(
  current: SigItem[] | null | undefined,
  backup: SigItem[] | null | undefined
): boolean {
  if (!backup || backup.length === 0) return false;
  if (!hasExpandedSigInventory(backup)) return false;
  const cur = current || [];
  if (isShrunkToDefaultSigInventory(cur)) return true;
  if (cur.length >= backup.length) return false;
  const curIds = new Set(cur.map((x) => String(x.id)));
  return backup.every((x) => curIds.has(String(x.id)));
}

export async function enrichAppStateWithSigInventoryBackup(
  userId: string,
  state: { sigInventory?: SigItem[] | null }
): Promise<{ sigInventory: SigItem[]; restoredFromBackup: boolean }> {
  const current = normalizeSigInventory(state.sigInventory);
  const backup = await loadSigInventoryBackup(userId);
  if (backup && shouldRestoreSigInventoryFromBackup(current, backup)) {
    return { sigInventory: backup, restoredFromBackup: true };
  }
  if (hasExpandedSigInventory(current)) {
    void saveSigInventoryBackup(userId, current);
  }
  return { sigInventory: current, restoredFromBackup: false };
}
