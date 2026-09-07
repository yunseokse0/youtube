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
 *  → 최초 false로 stuck되어 영구 "대기열" 표시되는 버그 방지
 *  🔴 FIX v3: 서로 다른 id의 5건 후원이 3초내에 들어와도 1건으로 병합되는 버그 해소.
 *             id가 다르면 진짜 별개 후원으로 간주 → 무조건 byId에 개별 추가.
 *             byNearContent bucket은 byId 내 같은 (name+amount+target) 그룹 중 richer 필드를 병합할 때만 참조. */
const NEAR_CONTENT_AT_WINDOW_MS = 3_000;

export async function appendToonaHubDonationLogs(
  userId: string,
  entries: ToonaHubDonationLog[]
): Promise<number> {
  const uid = String(userId || "").trim();
  if (!uid || !entries?.length) return 0;
  const prev = await readToonaHubDonationLogs(uid);

  // ==================== FixC_empty_id_fallback_generate_unique (2026-09-08 hotfix-6-10-5) ====================
  // DIN 허브 후원중 id=undefined/null/""/"0" 으로 넘어오는 경우가 매우 많음 (14건 후원 전부 id 가 empty 케이스!)
  // 이 경우 원래 append 로직: freshIds.add(undefined) 1번 → 나머지 13건은 freshIds.has(undefined) = true → continue 스킵 → 1건만 저장되는 Bug 발생 (14→4건 최종)
  // FixC: id가 empty 이면 donorName+at+amount+target 의 해시를 fallback 고유 id로 생성 → 서로 다른 후원은 절대 merge되지 않고 1:1 보존
  // 추가: NEAR_CONTENT_AT_WINDOW_MS 를 3000ms (3초) → 300ms (0.3초) 로 축소하여 버스트 후원(4초동안 14건)이 서로 다른 bucket에 들어가게 함으로 near merge가 공격적으로 병합되지 않도록 완화
  const NEAR_CONTENT_AT_WINDOW_MS_SAFE = 300; // 원본 3000 → 0.3초 (같은 1초내 들어온 진짜 중복 하나만 합치고 나머지는 별개 유지)
  function safeDonorId(entry: ToonaHubDonationLog): string {
    const raw = String(entry?.id || "").trim();
    if (raw && raw !== "0" && raw !== "null" && raw !== "undefined") return raw;
    // fallback pseudo-id: bucket + name + amount + at + target 을 결합한 해시
    const n = String(entry?.donorName || "").trim().toLowerCase();
    const a = Math.max(0, Math.round(Number(entry?.amount) || 0));
    const t = entry?.target === "account" ? "acc" : entry?.target === "toon" ? "toon" : "x";
    const ms = Math.max(0, Number(entry?.at) || 0);
    const msg = String(entry?.message || "").trim().slice(0, 32);
    let h1 = 0x811c9dc5;
    const combined = `${n}|${a}|${t}|${ms}|${msg}`;
    for (let i = 0; i < combined.length; i++) { h1 ^= combined.charCodeAt(i); h1 = Math.imul(h1, 0x01000193); }
    const hx = (h1 >>> 0).toString(16).padStart(8, "0");
    return `fallback-${ms}-${hx}`;
  }
  function nearContentKey(entry: ToonaHubDonationLog): string {
    const bucket = Math.floor(Number(entry.at || 0) / NEAR_CONTENT_AT_WINDOW_MS_SAFE);
    const name = String(entry.donorName || "").trim().toLowerCase();
    const amt = Math.max(0, Math.round(Number(entry.amount) || 0));
    const target = entry.target === "account" ? "account" : "toon";
    return `${name}|${amt}|${target}|${bucket}`;
  }
  // ==================== End FixC preamble ====================

  const byId = new Map<string, ToonaHubDonationLog>();
  for (const row of prev) if (row?.id) byId.set(safeDonorId(row), { ...row, id: safeDonorId(row) });

  function rebuildNearContent(): Map<string, ToonaHubDonationLog> {
    const byNearContent = new Map<string, ToonaHubDonationLog>();
    for (const row of byId.values()) {
      const k = nearContentKey(row);
      const cur = byNearContent.get(k);
      if (!cur) {
        byNearContent.set(k, row);
        continue;
      }
      const rowRicher =
        (row.playerName && !cur.playerName) ||
        (row.message && !cur.message) ||
        (row.applied && !cur.applied) ||
        (row.mode && !cur.mode);
      if (rowRicher) byNearContent.set(k, row);
    }
    return byNearContent;
  }

  const freshIds = new Set<string>();
  let newAddCount = 0;
  let mergeAppliedUpgrade = 0;
  let nearMergedCount = 0;
  for (const entry of entries) {
    if (!entry) continue;
    const eid = safeDonorId(entry);
    if (!eid || freshIds.has(eid)) continue;
    freshIds.add(eid);
    const normalizedEntry = { ...entry, id: eid };
    const existing = byId.get(eid);
    if (existing) {
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
      if (changed) byId.set(eid, next);
      continue;
    }

    byId.set(eid, normalizedEntry);
    newAddCount += 1;
  }

  const byNearContent = rebuildNearContent();
  for (const [k, richer] of byNearContent) {
    let mergedAny = false;
    for (const [rowId, row] of byId) {
      if (rowId === richer.id) continue;
      if (nearContentKey(row) !== k) continue;
      let changed = false;
      const next: ToonaHubDonationLog = { ...row };
      if (richer.playerName && !row.playerName) {
        next.playerName = richer.playerName;
        changed = true;
      }
      if (richer.message && !row.message) {
        next.message = richer.message;
        changed = true;
      }
      if (richer.mode && !row.mode) {
        next.mode = richer.mode;
        changed = true;
      }
      if (richer.applied && !row.applied) {
        next.applied = true;
        changed = true;
      }
      if (changed) {
        byId.set(rowId, next);
        mergedAny = true;
      }
    }
    if (mergedAny) nearMergedCount += 1;
  }
  const updatedRows = Array.from(byId.values()).sort((a, b) => b.at - a.at).slice(0, MAX_LOGS);
  if (newAddCount === 0 && mergeAppliedUpgrade === 0 && nearMergedCount === 0) return 0;
  if (isPersistentKvConfigured()) {
    const all = (await upstashGetJson<Record<string, ToonaHubDonationLog[]>>(LOG_KEY)) || {};
    all[uid] = updatedRows;
    await upstashSetJsonWithPipeline(LOG_KEY, all);
    return newAddCount + mergeAppliedUpgrade + nearMergedCount;
  }
  logMemory.set(uid, updatedRows);
  return newAddCount + mergeAppliedUpgrade + nearMergedCount;
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
