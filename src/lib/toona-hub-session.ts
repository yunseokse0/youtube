import { isPersistentKvConfigured, upstashGetJson, upstashSetJsonWithPipeline } from "@/app/api/_shared/upstash";

export type ToonaHubSession = {
  userId: string;
  baseUrl: string;
  email: string;
  streamKey: string;
  /** toona JWT — 서버만 보관 */
  token: string;
  linkedAt: number;
  displayName?: string;
  lastStatusAt?: number;
  lastStatusOk?: boolean;
  lastStatusError?: string | null;
  lastIngestAt?: string | null;
  lastIngestOk?: boolean | null;
  lastIngestError?: string | null;
  youtubegitEnabled?: boolean;
  youtubeUserId?: string;
  /** scenario A→B 승격 시도 시각 — 폴링마다 PATCH 반복 방지 */
  scenarioBPromoteAt?: number;
};

export type ToonaHubDonationLog = {
  id: string;
  at: number;
  donorName: string;
  amount: number;
  playerName?: string;
  target?: "account" | "toon";
  mode?: string;
  applied?: boolean;
  source: "ingest" | "toona";
  message?: string;
};

const SESSION_KEY = "toona-hub-session-v1";
const LOG_KEY = "toona-hub-donation-log-v1";
const MAX_LOGS = 80;

const sessionMemory = new Map<string, ToonaHubSession>();
const logMemory = new Map<string, ToonaHubDonationLog[]>();

export async function readToonaHubSession(userId: string): Promise<ToonaHubSession | null> {
  const uid = String(userId || "").trim();
  if (!uid) return null;
  if (isPersistentKvConfigured()) {
    const all = await upstashGetJson<Record<string, ToonaHubSession>>(SESSION_KEY);
    const row = all?.[uid];
    return row && typeof row === "object" && row.token && row.streamKey ? row : null;
  }
  return sessionMemory.get(uid) || null;
}

export async function writeToonaHubSession(session: ToonaHubSession): Promise<void> {
  const uid = String(session.userId || "").trim();
  if (!uid) return;
  if (isPersistentKvConfigured()) {
    const all = (await upstashGetJson<Record<string, ToonaHubSession>>(SESSION_KEY)) || {};
    all[uid] = session;
    await upstashSetJsonWithPipeline(SESSION_KEY, all);
    return;
  }
  sessionMemory.set(uid, session);
}

export async function clearToonaHubSession(userId: string): Promise<void> {
  const uid = String(userId || "").trim();
  if (!uid) return;
  if (isPersistentKvConfigured()) {
    const all = (await upstashGetJson<Record<string, ToonaHubSession>>(SESSION_KEY)) || {};
    delete all[uid];
    await upstashSetJsonWithPipeline(SESSION_KEY, all);
  } else {
    sessionMemory.delete(uid);
  }
}

export async function readToonaHubDonationLogs(userId: string): Promise<ToonaHubDonationLog[]> {
  const uid = String(userId || "").trim();
  if (!uid) return [];
  if (isPersistentKvConfigured()) {
    const all = await upstashGetJson<Record<string, ToonaHubDonationLog[]>>(LOG_KEY);
    const rows = all?.[uid];
    return Array.isArray(rows) ? rows : [];
  }
  return logMemory.get(uid) || [];
}

export async function appendToonaHubDonationLog(
  userId: string,
  entry: ToonaHubDonationLog
): Promise<void> {
  await appendToonaHubDonationLogs(userId, [entry]);
}

/** 후원 로그 일괄 추가 — hub poll 시 건당 KV RMW 폭주 방지
 *  같은 id 재입력시 기존 applied=false → 신규 applied=true 만 업그레이드 (절대 true→false 다운그레이드 금지)
 *  → 최초 false로 stuck되어 영구 "대기열" 표시되는 버그 방지 */
export async function appendToonaHubDonationLogs(
  userId: string,
  entries: ToonaHubDonationLog[]
): Promise<number> {
  const uid = String(userId || "").trim();
  if (!uid || !entries?.length) return 0;
  const prev = await readToonaHubDonationLogs(uid);
  const byId = new Map<string, ToonaHubDonationLog>();
  for (const row of prev) if (row?.id) byId.set(row.id, row);
  const freshIds = new Set<string>();
  let newAddCount = 0;
  let mergeAppliedUpgrade = 0;
  for (const entry of entries) {
    if (!entry?.id || freshIds.has(entry.id)) continue;
    freshIds.add(entry.id);
    const existing = byId.get(entry.id);
    if (!existing) {
      byId.set(entry.id, entry);
      newAddCount += 1;
      continue;
    }
    let changed = false;
    const next: ToonaHubDonationLog = { ...existing };
    if (!existing.applied && entry.applied) {
      next.applied = true;
      changed = true;
      mergeAppliedUpgrade += 1;
    }
    if (entry.mode && existing.mode !== entry.mode) {
      next.mode = entry.mode;
      changed = true;
    }
    if (entry.playerName && !existing.playerName) {
      next.playerName = entry.playerName;
      changed = true;
    }
    if (entry.message && !existing.message) {
      next.message = entry.message;
      changed = true;
    }
    if (entry.amount && !existing.amount) {
      next.amount = entry.amount;
      changed = true;
    }
    if (changed) byId.set(entry.id, next);
  }
  const updatedRows = Array.from(byId.values()).sort((a, b) => b.at - a.at).slice(0, MAX_LOGS);
  if (newAddCount === 0 && mergeAppliedUpgrade === 0) return 0;
  if (isPersistentKvConfigured()) {
    const all = (await upstashGetJson<Record<string, ToonaHubDonationLog[]>>(LOG_KEY)) || {};
    all[uid] = updatedRows;
    await upstashSetJsonWithPipeline(LOG_KEY, all);
    return newAddCount + mergeAppliedUpgrade;
  }
  logMemory.set(uid, updatedRows);
  return newAddCount + mergeAppliedUpgrade;
}

export async function clearToonaHubDonationLogs(userId: string): Promise<void> {
  const uid = String(userId || "").trim();
  if (!uid) return;
  if (isPersistentKvConfigured()) {
    const all = (await upstashGetJson<Record<string, ToonaHubDonationLog[]>>(LOG_KEY)) || {};
    delete all[uid];
    await upstashSetJsonWithPipeline(LOG_KEY, all);
  } else {
    logMemory.delete(uid);
  }
}

/** 클라이언트에 내려줄 때 token 제외 */
export function publicToonaHubSession(session: ToonaHubSession | null) {
  if (!session) return null;
  return {
    email: session.email,
    streamKey: session.streamKey,
    baseUrl: session.baseUrl,
    linkedAt: session.linkedAt,
    displayName: session.displayName || null,
    lastStatusAt: session.lastStatusAt || null,
    lastStatusOk: session.lastStatusOk ?? null,
    lastStatusError: session.lastStatusError || null,
    lastIngestAt: session.lastIngestAt || null,
    lastIngestOk: session.lastIngestOk ?? null,
    lastIngestError: session.lastIngestError || null,
    youtubegitEnabled: session.youtubegitEnabled ?? null,
    youtubeUserId: session.youtubeUserId || null,
  };
}
