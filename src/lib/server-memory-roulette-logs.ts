import type { RouletteSessionLog } from "@/lib/sig-roulette";

let cachedLogs: Record<string, RouletteSessionLog[]> = {};

export function getServerMemoryRouletteLogs(key: string): RouletteSessionLog[] {
  return cachedLogs[key] || [];
}

export function setServerMemoryRouletteLogs(key: string, logs: RouletteSessionLog[]): void {
  cachedLogs[key] = logs;
}
