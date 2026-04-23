const rouletteLockMap = new Map<string, number>();

export function setRouletteLock(userId: string, durationMs: number): void {
  const now = Date.now();
  rouletteLockMap.set(userId, now + Math.max(0, Math.floor(durationMs)));
}

export function clearRouletteLock(userId: string): void {
  rouletteLockMap.delete(userId);
}

export function isRouletteLocked(userId: string): boolean {
  const until = rouletteLockMap.get(userId);
  if (!until) return false;
  if (until <= Date.now()) {
    rouletteLockMap.delete(userId);
    return false;
  }
  return true;
}
