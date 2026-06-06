import WebSocket from "ws";
import { createModuleLogger } from "@/lib/logger";
import { enqueueDonationEvent } from "./enqueue-donation";
import {
  clearToonationListenerConfig,
  readAllEnabledToonationListenerConfigs,
  readToonationListenerConfig,
  writeToonationListenerConfig,
  type ToonationListenerConfig,
} from "./listener-config-store";
import { parseToonationWebSocketMessage } from "./parse-event";
import { normalizeToonationAlertboxUrl } from "./link-key";
import { resolveToonationWsPayload } from "./resolve-payload";

const log = createModuleLogger("Toonation/ServerListener");

const PING_MS = 12_000;
const RECONNECT_MS = 10_000;

export type ToonationServerListenerStatus = {
  userId: string;
  enabled: boolean;
  alertboxUrl: string;
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

function statusFromConn(conn: ActiveConnection): ToonationServerListenerStatus {
  return {
    userId: conn.userId,
    enabled: !conn.stopped,
    alertboxUrl: conn.alertboxUrl,
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

async function onDonation(userId: string, raw: string): Promise<void> {
  const event = parseToonationWebSocketMessage(raw);
  if (!event) return;
  const conn = active.get(userId);
  if (conn) {
    conn.lastDonationAt = Date.now();
    conn.lastEventAt = conn.lastDonationAt;
  }
  const added = await enqueueDonationEvent(userId, event);
  if (added) {
    log.info("후원 큐 등록", { userId, donor: event.donorName, amount: event.amount });
  }
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
    void onDonation(conn.userId, raw);
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

function ensureActiveConnection(userId: string, alertboxUrl: string): ActiveConnection {
  const existing = active.get(userId);
  if (existing && existing.alertboxUrl === alertboxUrl && !existing.stopped) {
    return existing;
  }
  if (existing) {
    stopToonationServerListener(userId);
  }
  const conn: ActiveConnection = {
    userId,
    alertboxUrl,
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
  alertboxUrlOrKey: string
): Promise<ToonationServerListenerStatus> {
  const url = normalizeToonationAlertboxUrl(alertboxUrlOrKey);
  if (!url) throw new Error("invalid_toonation_alertbox_url");

  const config: ToonationListenerConfig = {
    userId,
    alertboxUrl: url,
    enabled: true,
    updatedAt: Date.now(),
  };
  await writeToonationListenerConfig(config);
  const conn = ensureActiveConnection(userId, url);
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
    ensureActiveConnection(cfg.userId, cfg.alertboxUrl);
  }
}

export async function syncToonationServerListener(
  userId: string,
  alertboxUrl: string,
  enabled: boolean
): Promise<ToonationServerListenerStatus | null> {
  if (!enabled || !alertboxUrl.trim()) {
    await disableToonationServerListener(userId);
    return null;
  }
  return startToonationServerListener(userId, alertboxUrl);
}

export async function getToonationListenerStatusForUser(userId: string): Promise<ToonationServerListenerStatus | null> {
  const live = getToonationServerListenerStatus(userId);
  if (live) return live;
  const saved = await readToonationListenerConfig(userId);
  if (!saved) return null;
  return {
    userId: saved.userId,
    enabled: saved.enabled,
    alertboxUrl: saved.alertboxUrl,
    connected: false,
    updatedAt: saved.updatedAt,
  };
}
