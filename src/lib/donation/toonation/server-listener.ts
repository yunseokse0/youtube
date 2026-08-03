import WebSocket from "ws";
import { createModuleLogger } from "@/lib/logger";
import { tryAutoApplyToonationDonationOnServer, enqueueUnmatchedToonationDonation } from "../server-apply-donation";
import type { DonationEvent } from "../types";
import {
  clearToonationListenerConfig,
  readAllEnabledToonationListenerConfigs,
  readToonationListenerConfig,
  writeToonationListenerConfig,
  type ToonationListenerConfig,
} from "./listener-config-store";
import {
  isReliableToonationExternalId,
  isToonationTestDonationPayload,
  isToonationYoutubeSuperChatWsMessage,
  parseToonationWebSocketMessage,
  peekToonationWsPayload,
  TOONATION_WS_CODE_DONATION,
  TOONATION_WS_CODE_YOUTUBE_SUPERCHAT,
} from "./parse-event";
import { applyOwnerDonationRemapIfNeeded, getOwnerNameCandidates } from "./owner-donation-remap";
import { isWeakToonationDonorId } from "../apply-donation-state";
import { normalizeToonationAlertboxUrl } from "./link-key";
import { resolveToonationWsPayload } from "./resolve-payload";

const log = createModuleLogger("Toonation/ServerListener");

/**
 * CORE / FROZEN (2026-08-03): 투네 실시간 자동 수집.
 * 아키텍처·dedupe 변경은 사용자 명시 요청 + server-listener-ingest.test 통과 필수.
 * @see .cursor/rules/toonation-auto-collect-freeze.mdc
 */

const PING_MS = 12_000;
const RECONNECT_MS = 10_000;

export type ToonationServerListenerStatus = {
  userId: string;
  enabled: boolean;
  alertboxUrl: string;
  ownerName?: string;
  connected: boolean;
  wsPayload?: string;
  lastEventAt?: number;
  lastDonationAt?: number;
  lastError?: string;
  updatedAt: number;
};

type ActiveConnection = {
  userId: string;
  alertboxUrl: string;
  ownerName?: string;
  ws: WebSocket | null;
  wsPayload: string;
  pingTimer: ReturnType<typeof setInterval> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  stopped: boolean;
  connected: boolean;
  lastEventAt?: number;
  lastDonationAt?: number;
  lastError?: string;
};

const active = new Map<string, ActiveConnection>();
const ingestMetaByUser = new Map<string, { lastEventAt?: number; lastDonationAt?: number }>();

function touchIngestMeta(userId: string, patch: { lastEventAt?: number; lastDonationAt?: number }) {
  const prev = ingestMetaByUser.get(userId) || {};
  ingestMetaByUser.set(userId, { ...prev, ...patch });
}

function syncConnFromIngest(userId: string, patch: { lastEventAt?: number; lastDonationAt?: number }) {
  touchIngestMeta(userId, patch);
  const conn = active.get(userId);
  if (!conn) return;
  if (typeof patch.lastEventAt === "number") conn.lastEventAt = patch.lastEventAt;
  if (typeof patch.lastDonationAt === "number") conn.lastDonationAt = patch.lastDonationAt;
}

/** 동일 WS 원문 재전송(수백 ms)만 무시 — 연속 동일 후원은 통과 */
const RAW_WS_DEDUPE_MS = 500;
const recentRawWsByUser = new Map<string, Map<string, number>>();
const recentEventByUser = new Map<string, Map<string, number>>();
const EVENT_DEDUPE_MS = 60_000;

function donationEventDedupeKey(event: DonationEvent): string {
  const ext = String(event.externalId || "").trim();
  if (ext) return `${event.provider || "toonation"}:${ext}`;
  return String(event.id || "").trim();
}

function shouldSkipDuplicateEvent(userId: string, event: DonationEvent): boolean {
  const ext = String(event.externalId || "").trim();
  const eventId = String(event.id || "").trim();
  /**
   * fp-/test- 등 fallback id 는 건마다 달라지거나 동일 금액 연속일 수 있음.
   * 재전송 차단은 RAW_WS_DEDUPE 에 맡기고, 여기선 투네 실 id 만 60초 무시.
   */
  if (
    !ext ||
    !isReliableToonationExternalId(ext) ||
    isWeakToonationDonorId(eventId) ||
    isWeakToonationDonorId(`toonation:${ext}`)
  ) {
    return false;
  }
  const key = donationEventDedupeKey(event);
  if (!key) return false;
  const now = Date.now();
  let map = recentEventByUser.get(userId);
  if (!map) {
    map = new Map();
    recentEventByUser.set(userId, map);
  }
  const prev = map.get(key);
  if (typeof prev === "number" && now - prev < EVENT_DEDUPE_MS) return true;
  map.set(key, now);
  if (map.size > 200) {
    for (const [k, at] of map) {
      if (now - at > EVENT_DEDUPE_MS) map.delete(k);
    }
  }
  return false;
}

function hashRawWsMessage(raw: string): string {
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** 동일 WS 원문 재전송만 짧게 무시 — 연속 동일 후원(다른 id·원문)은 통과 */
function shouldSkipDuplicateRawWs(userId: string, raw: string, windowMs = RAW_WS_DEDUPE_MS): boolean {
  const hash = hashRawWsMessage(raw);
  const now = Date.now();
  let map = recentRawWsByUser.get(userId);
  if (!map) {
    map = new Map();
    recentRawWsByUser.set(userId, map);
  }
  const prev = map.get(hash);
  if (typeof prev === "number" && now - prev < windowMs) return true;
  map.set(hash, now);
  const pruneAfter = Math.max(windowMs, RAW_WS_DEDUPE_MS);
  if (map.size > 200) {
    for (const [key, at] of map) {
      if (now - at > pruneAfter) map.delete(key);
    }
  }
  return false;
}

function statusFromConn(conn: ActiveConnection): ToonationServerListenerStatus {
  return {
    userId: conn.userId,
    enabled: !conn.stopped,
    alertboxUrl: conn.alertboxUrl,
    ownerName: conn.ownerName || "",
    connected: conn.connected,
    wsPayload: conn.wsPayload,
    lastEventAt: conn.lastEventAt,
    lastDonationAt: conn.lastDonationAt,
    lastError: conn.lastError,
    updatedAt: Date.now(),
  };
}

function clearTimers(conn: ActiveConnection) {
  if (conn.pingTimer) {
    clearInterval(conn.pingTimer);
    conn.pingTimer = null;
  }
  if (conn.reconnectTimer) {
    clearTimeout(conn.reconnectTimer);
    conn.reconnectTimer = null;
  }
}

function scheduleReconnect(conn: ActiveConnection) {
  if (conn.stopped || conn.reconnectTimer) return;
  conn.reconnectTimer = setTimeout(() => {
    conn.reconnectTimer = null;
    if (!conn.stopped) void connectWs(conn);
  }, RECONNECT_MS);
}

export type ToonationIngestOutcome =
  | { ok: true; outcome: "applied" | "applied_needs_review" | "ignored" | "duplicate" }
  | { ok: false; reason: "parse_failed" | "queue_failed" | "not_applied" };

/** WS·OBS 릴레이 공통 — 후원 1건 처리 */
export async function ingestToonationWebSocketMessage(
  userId: string,
  raw: string,
  ownerName?: string
): Promise<ToonationIngestOutcome> {
  const payload = peekToonationWsPayload(raw);
  const isTestDonation = payload != null && isToonationTestDonationPayload(payload);
  /**
   * 투네 후원 테스트는 클릭마다 WS 원문이 거의 동일하다.
   * 테스트는 건별 unique externalId 로 반영하고, WS 재전송 중복은 드물어 dedupe 를 건너뛴다.
   */
  if (!isTestDonation && shouldSkipDuplicateRawWs(userId, raw, RAW_WS_DEDUPE_MS)) {
    return { ok: true, outcome: "duplicate" };
  }

  /** 설정·핑 등 비후원 WS도 수신 여부 확인용 */
  try {
    const envelope = JSON.parse(raw) as Record<string, unknown>;
    const code = Number(envelope.code);
    if (code === TOONATION_WS_CODE_DONATION || code === TOONATION_WS_CODE_YOUTUBE_SUPERCHAT) {
      syncConnFromIngest(userId, { lastEventAt: Date.now() });
    }
  } catch {
    /* noop */
  }

  const parsed = parseToonationWebSocketMessage(raw);
  if (!parsed) return { ok: true, outcome: "ignored" };

  let event = parsed;
  try {
    const ownerNames = await getOwnerNameCandidates(userId, ownerName);
    event = applyOwnerDonationRemapIfNeeded(event, ownerNames);
  } catch {
    /* noop */
  }

  if (shouldSkipDuplicateEvent(userId, event)) {
    return { ok: true, outcome: "duplicate" };
  }

  const conn = active.get(userId);
  syncConnFromIngest(userId, { lastEventAt: Date.now() });

  const outcome = await tryAutoApplyToonationDonationOnServer(userId, event);
  if (outcome === "applied" || outcome === "applied_needs_review") {
    syncConnFromIngest(userId, { lastDonationAt: Date.now() });
  }
  if (outcome === "applied" || outcome === "applied_needs_review") {
    return { ok: true, outcome };
  }

  const added = await enqueueUnmatchedToonationDonation(userId, event);
  if (added) return { ok: true, outcome: "applied_needs_review" };
  return { ok: false, reason: "not_applied" };
}

async function onDonation(userId: string, raw: string, ownerName?: string): Promise<void> {
  try {
    const envelope = JSON.parse(raw) as Record<string, unknown>;
    if (envelope && isToonationYoutubeSuperChatWsMessage(envelope)) {
      log.debug("유튜브 슈퍼챗 감지(엑셀표 반영 시도)", { userId, code: envelope.code });
    }
  } catch {
    /* noop */
  }

  const result = await ingestToonationWebSocketMessage(userId, raw, ownerName);
  if (result.ok && result.outcome === "ignored") {
    log.debug("후원 WS 파싱 불가 — 무시", { userId, rawPreview: raw.slice(0, 240) });
    return;
  }
  if (result.ok && result.outcome === "duplicate") {
    log.debug("동일 후원 이벤트 재전송 무시", { userId });
    return;
  }
  if (result.ok && (result.outcome === "applied" || result.outcome === "applied_needs_review")) {
    log.info(result.outcome === "applied" ? "후원 엑셀표 자동 반영" : "후원 자동 반영(멤버 확인 필요)", {
      userId,
      outcome: result.outcome,
    });
    return;
  }
  log.warn("후원 자동 반영 실패", { userId, reason: result.ok ? result.outcome : result.reason });
}

async function connectWs(conn: ActiveConnection): Promise<void> {
  clearTimers(conn);
  if (conn.ws) {
    try {
      conn.ws.removeAllListeners();
      conn.ws.terminate();
    } catch {
      /* ignore */
    }
    conn.ws = null;
  }
  conn.connected = false;

  if (conn.stopped) return;

  try {
    conn.wsPayload = await resolveToonationWsPayload(conn.alertboxUrl);
  } catch (err) {
    conn.lastError = err instanceof Error ? err.message : String(err);
    log.warn("Alertbox payload 조회 실패", { userId: conn.userId, error: conn.lastError });
    scheduleReconnect(conn);
    return;
  }

  const wsUrl = `wss://ws.toon.at/${conn.wsPayload}`;
  const ws = new WebSocket(wsUrl);
  conn.ws = ws;

  ws.on("open", () => {
    conn.connected = true;
    conn.lastError = undefined;
    log.info("WebSocket 연결됨", { userId: conn.userId });
    conn.pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.ping();
        } catch {
          /* ignore */
        }
      }
    }, PING_MS);
  });

  ws.on("message", (data) => {
    conn.lastEventAt = Date.now();
    const raw = typeof data === "string" ? data : data.toString("utf8");
    void onDonation(conn.userId, raw, conn.ownerName);
  });

  ws.on("close", () => {
    conn.connected = false;
    clearTimers(conn);
    if (!conn.stopped) {
      log.warn("WebSocket 종료 — 재연결 예약", { userId: conn.userId });
      scheduleReconnect(conn);
    }
  });

  ws.on("error", (err) => {
    conn.lastError = err.message || "websocket_error";
    conn.connected = false;
    log.warn("WebSocket 오류", { userId: conn.userId, error: conn.lastError });
  });
}

function ensureActiveConnection(userId: string, alertboxUrl: string, ownerName?: string): ActiveConnection {
  const existing = active.get(userId);
  if (
    existing &&
    existing.alertboxUrl === alertboxUrl &&
    String(existing.ownerName || "").trim() === String(ownerName || "").trim() &&
    !existing.stopped
  ) {
    return existing;
  }
  if (existing) {
    stopToonationServerListener(userId);
  }
  const conn: ActiveConnection = {
    userId,
    alertboxUrl,
    ownerName: String(ownerName || "").trim(),
    ws: null,
    wsPayload: "",
    pingTimer: null,
    reconnectTimer: null,
    stopped: false,
    connected: false,
  };
  active.set(userId, conn);
  void connectWs(conn);
  return conn;
}

export async function startToonationServerListener(
  userId: string,
  alertboxUrlOrKey: string,
  ownerName?: string
): Promise<ToonationServerListenerStatus> {
  const url = normalizeToonationAlertboxUrl(alertboxUrlOrKey);
  if (!url) throw new Error("invalid_toonation_alertbox_url");

  const config: ToonationListenerConfig = {
    userId,
    alertboxUrl: url,
    ownerName: String(ownerName || "").trim(),
    enabled: true,
    updatedAt: Date.now(),
  };
  await writeToonationListenerConfig(config);
  const conn = ensureActiveConnection(userId, url, ownerName);
  return statusFromConn(conn);
}

export function stopToonationServerListener(userId: string): void {
  const conn = active.get(userId);
  if (!conn) return;
  conn.stopped = true;
  clearTimers(conn);
  if (conn.ws) {
    try {
      conn.ws.removeAllListeners();
      conn.ws.terminate();
    } catch {
      /* ignore */
    }
    conn.ws = null;
  }
  conn.connected = false;
  active.delete(userId);
}

/** 실시간 수집 OFF — WS만 끊고 연동키·주인명은 Redis에 유지(재시작·오버레이 릴레이용) */
export async function pauseToonationServerListener(
  userId: string,
  preserve?: { alertboxUrl: string; ownerName?: string }
): Promise<void> {
  stopToonationServerListener(userId);
  const saved = await readToonationListenerConfig(userId);
  const alertboxUrl =
    normalizeToonationAlertboxUrl(String(preserve?.alertboxUrl || "").trim()) ||
    saved?.alertboxUrl ||
    "";
  if (!alertboxUrl) return;
  await writeToonationListenerConfig({
    userId,
    alertboxUrl,
    ownerName: String(preserve?.ownerName ?? saved?.ownerName ?? "").trim(),
    enabled: false,
    updatedAt: Date.now(),
  });
}

export async function disableToonationServerListener(userId: string): Promise<void> {
  stopToonationServerListener(userId);
  await clearToonationListenerConfig(userId);
}

export function getToonationServerListenerStatus(userId: string): ToonationServerListenerStatus | null {
  const conn = active.get(userId);
  if (conn) return statusFromConn(conn);
  return null;
}

export async function restoreToonationListenersFromStore(): Promise<void> {
  const configs = await readAllEnabledToonationListenerConfigs();
  for (const cfg of configs) {
    if (!cfg.userId || !cfg.alertboxUrl) continue;
    log.info("저장된 투네 리스너 복구", { userId: cfg.userId });
    ensureActiveConnection(cfg.userId, cfg.alertboxUrl, cfg.ownerName);
  }
}

export async function syncToonationServerListener(
  userId: string,
  alertboxUrl: string,
  enabled: boolean,
  ownerName?: string
): Promise<ToonationServerListenerStatus | null> {
  const url = normalizeToonationAlertboxUrl(alertboxUrl.trim()) || alertboxUrl.trim();
  if (!enabled) {
    await pauseToonationServerListener(
      userId,
      url ? { alertboxUrl: url, ownerName } : undefined
    );
    if (!url) return null;
    return {
      userId,
      enabled: false,
      alertboxUrl: url,
      ownerName: String(ownerName || "").trim(),
      connected: false,
      updatedAt: Date.now(),
    };
  }
  if (!url) {
    await pauseToonationServerListener(userId);
    return null;
  }
  return startToonationServerListener(userId, url, ownerName);
}

export async function getToonationListenerStatusForUser(userId: string): Promise<ToonationServerListenerStatus | null> {
  const live = getToonationServerListenerStatus(userId);
  const ingestMeta = ingestMetaByUser.get(userId);
  if (live) {
    return {
      ...live,
      lastEventAt: Math.max(live.lastEventAt || 0, ingestMeta?.lastEventAt || 0) || live.lastEventAt,
      lastDonationAt: Math.max(live.lastDonationAt || 0, ingestMeta?.lastDonationAt || 0) || live.lastDonationAt,
    };
  }
  const saved = await readToonationListenerConfig(userId);
  if (!saved && !ingestMeta) return null;
  if (!saved) {
    return {
      userId,
      enabled: false,
      alertboxUrl: "",
      ownerName: "",
      connected: false,
      lastEventAt: ingestMeta?.lastEventAt,
      lastDonationAt: ingestMeta?.lastDonationAt,
      updatedAt: Date.now(),
    };
  }
  return {
    userId: saved.userId,
    enabled: saved.enabled,
    alertboxUrl: saved.alertboxUrl,
    ownerName: saved.ownerName || "",
    connected: false,
    lastEventAt: ingestMeta?.lastEventAt,
    lastDonationAt: ingestMeta?.lastDonationAt,
    updatedAt: saved.updatedAt,
  };
}
