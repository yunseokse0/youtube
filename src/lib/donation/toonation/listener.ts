"use client";

import { io, type Socket } from "socket.io-client";
import type { DonationEvent, QueueSigItem } from "../types";

let toonationSocket: Socket | null = null;
let sigSnapshotCache: QueueSigItem[] = [];
let sigSnapshotCacheAt = 0;
/** 동시에 여러 알림이 들어올 때 동일 스냅샷 요청을 한 번으로 합침 */
let sigSnapshotInflight: Promise<QueueSigItem[]> | null = null;

const SIG_SNAPSHOT_MIN_MS = 10_000;

/** `NEXT_PUBLIC_TOONATION_SOCKET_ENABLED=true`(또는 `1`)일 때만 toon.at 소켓 연결. 그 외에는 연결하지 않음. */
function isToonationSocketEnabled(): boolean {
  const v = String(process.env.NEXT_PUBLIC_TOONATION_SOCKET_ENABLED ?? "").trim().toLowerCase();
  return v === "true" || v === "1";
}

export type ToonationListenerStatus = {
  kind: "connected" | "disconnected" | "reconnect_attempt" | "reconnect_error" | "reconnect_failed" | "connect_error";
  message: string;
  attempt?: number;
  nextDelayMs?: number;
};

type ListenerOptions = {
  userId?: string;
  onStatus?: (status: ToonationListenerStatus) => void;
  /** true: 수신하는 모든 Socket 이벤트명·첫 인자를 브라우저 콘솔에 출력(데이터 구조 파악용) */
  socketDebug?: boolean;
};

function safeRead(obj: unknown, key: string): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  return (obj as Record<string, unknown>)[key];
}

function extractAmount(data: unknown): number {
  const candidates = [
    safeRead(data, "amount"),
    safeRead(data, "price"),
    safeRead(data, "donationAmount"),
    safeRead(data, "value"),
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return 0;
}

function extractDonorName(data: unknown): string {
  const candidates = [
    safeRead(data, "nickname"),
    safeRead(data, "sender"),
    safeRead(data, "userName"),
    safeRead(data, "name"),
  ];
  for (const c of candidates) {
    const s = String(c || "").trim();
    if (s) return s;
  }
  return "Unknown";
}

function toDonationEvent(data: unknown): DonationEvent | null {
  const amount = extractAmount(data);
  if (amount <= 0) return null;

  const externalId = String(safeRead(data, "id") || `${Date.now()}`);
  return {
    id: `toonation:${externalId}`,
    provider: "toonation",
    externalId,
    donorName: extractDonorName(data),
    amount,
    message: String(safeRead(data, "message") || safeRead(data, "comment") || ""),
    at: new Date().toISOString(),
    target: "toon",
    status: "queued",
  };
}

async function enqueueMonitoringEvent(event: DonationEvent, userId?: string): Promise<void> {
  const sigListSnapshot = await loadSigListSnapshot(userId);
  const q = userId ? `?u=${encodeURIComponent(userId)}` : "";
  await fetch(`/api/donations/queue${q}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...event, status: "queued", sigListSnapshot }),
  }).catch(() => {});
}

async function loadSigListSnapshot(userId?: string): Promise<QueueSigItem[]> {
  const now = Date.now();
  /** 빈 배열이어도 캐시 시간이 유효하면 재요청하지 않음(알림 폭주 시 GET /api/state 수천 방지) */
  if (sigSnapshotCacheAt > 0 && now - sigSnapshotCacheAt < SIG_SNAPSHOT_MIN_MS) {
    return sigSnapshotCache;
  }
  if (sigSnapshotInflight) return sigSnapshotInflight;

  const params = new URLSearchParams();
  if (userId) {
    params.set("u", userId);
    params.set("user", userId);
  }
  /** 전체 오버레이 JSON이 아니라 시그 목록만 — 대기 큐 메타용 스냅샷 */
  params.set("pick", "sigInventory");
  const qs = params.toString();

  sigSnapshotInflight = (async () => {
    try {
      const res = await fetch(`/api/state?${qs}`, { cache: "no-store" }).catch(() => null);
      if (!res || !res.ok) {
        sigSnapshotCacheAt = Date.now();
        return sigSnapshotCache;
      }
      const data = (await res.json()) as { sigInventory?: Array<Record<string, unknown>> };
      const inv = Array.isArray(data.sigInventory) ? data.sigInventory : [];
      const snapshot: QueueSigItem[] = inv
        .filter((x) => Boolean(x && x.id && x.name))
        .map((x) => ({
          id: String(x.id),
          name: String(x.name),
          price: Math.max(0, Math.round(Number(x.price || 0))),
          isActive: Boolean(x.isActive),
          soldCount: Number.isFinite(Number(x.soldCount)) ? Math.max(0, Math.floor(Number(x.soldCount))) : undefined,
          maxCount: Number.isFinite(Number(x.maxCount)) ? Math.max(0, Math.floor(Number(x.maxCount))) : undefined,
        }));
      sigSnapshotCache = snapshot;
      sigSnapshotCacheAt = Date.now();
      return snapshot;
    } finally {
      sigSnapshotInflight = null;
    }
  })();

  return sigSnapshotInflight;
}

export function startToonationListener(alertboxUrl: string, options?: ListenerOptions): Socket | null {
  if (!isToonationSocketEnabled()) {
    stopToonationListener();
    return null;
  }
  if (toonationSocket) toonationSocket.disconnect();
  const onStatus = options?.onStatus;
  const userId = options?.userId;
  const socketDebug = Boolean(options?.socketDebug);

  const key = new URL(alertboxUrl).pathname.split("/").filter(Boolean).pop();
  if (!key) throw new Error("invalid_toonation_alertbox_url");

  const baseDelay = 3000;
  toonationSocket = io("https://toon.at", {
    path: `/widget/alertbox/${key}/socket.io`,
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: 15,
    reconnectionDelay: baseDelay,
    reconnectionDelayMax: 15000,
    randomizationFactor: 0.2,
    timeout: 10000,
  });

  toonationSocket.on("connect", () => {
    console.log("toonation: socket connected");
    onStatus?.({ kind: "connected", message: "투네이션 연결됨" });
  });

  toonationSocket.onAny((eventName: string, ...args: unknown[]) => {
    if (socketDebug) {
      try {
        const first = args[0];
        const body =
          first !== undefined && typeof first === "object"
            ? JSON.stringify(first).slice(0, 6000)
            : String(first);
        console.info("[toonation socket]", eventName, body);
      } catch {
        console.info("[toonation socket]", eventName, "(serialize failed)", args.length);
      }
    }
    const isDonationLike = eventName.includes("donation") || eventName.includes("alert");
    if (!isDonationLike) return;
    const event = toDonationEvent(args[0]);
    if (!event) return;
    void enqueueMonitoringEvent(event, userId);
  });

  toonationSocket.on("disconnect", (reason: string) => {
    console.log("toonation: socket disconnected", reason);
    onStatus?.({ kind: "disconnected", message: `연결 끊김: ${reason}` });
  });

  toonationSocket.on("connect_error", (err: Error) => {
    onStatus?.({ kind: "connect_error", message: `연결 오류: ${err.message || "unknown"}` });
  });

  toonationSocket.io.on("reconnect_attempt", (attempt: number) => {
    const nextDelayMs = Math.min(15000, Math.round(baseDelay * Math.pow(1.6, Math.max(0, attempt - 1))));
    onStatus?.({
      kind: "reconnect_attempt",
      message: `재연결 시도 #${attempt}`,
      attempt,
      nextDelayMs,
    });
  });

  toonationSocket.io.on("reconnect_error", (err: Error) => {
    onStatus?.({ kind: "reconnect_error", message: `재연결 실패: ${err.message || "unknown"}` });
  });

  toonationSocket.io.on("reconnect_failed", () => {
    onStatus?.({ kind: "reconnect_failed", message: "재연결 한도 초과" });
  });

  return toonationSocket;
}

export function stopToonationListener() {
  toonationSocket?.disconnect();
  toonationSocket = null;
}
