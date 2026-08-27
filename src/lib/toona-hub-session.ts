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
  const uid = String(userId || "").trim();
  if (!uid || !entry?.id) return;
  const prev = await readToonaHubDonationLogs(uid);
  if (prev.some((x) => x.id === entry.id)) return;
  const next = [entry, ...prev].slice(0, MAX_LOGS);
  if (isPersistentKvConfigured()) {
    const all = (await upstashGetJson<Record<string, ToonaHubDonationLog[]>>(LOG_KEY)) || {};
    all[uid] = next;
    await upstashSetJsonWithPipeline(LOG_KEY, all);
    return;
  }
  logMemory.set(uid, next);
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
