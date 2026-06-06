"use client";

export type ToonationListenerStatus = {
  kind: "connected" | "disconnected" | "reconnect_attempt" | "reconnect_error" | "reconnect_failed" | "connect_error" | "idle" | "syncing" | "error";
  message: string;
  attempt?: number;
  nextDelayMs?: number;
};

export type ToonationServerStatus = {
  userId: string;
  enabled: boolean;
  alertboxUrl: string;
  connected: boolean;
  wsPayload?: string;
  lastEventAt?: number;
  lastDonationAt?: number;
  lastError?: string;
  updatedAt: number;
} | null;

function statusFromServer(status: ToonationServerStatus): ToonationListenerStatus {
  if (!status) {
    return { kind: "idle", message: "실시간 수집 꺼짐" };
  }
  if (status.lastError && !status.connected) {
    return { kind: "error", message: status.lastError };
  }
  if (status.connected) {
    return { kind: "connected", message: "투네이션 WebSocket 연결됨" };
  }
  if (status.enabled) {
    return { kind: "syncing", message: "연결 중…" };
  }
  return { kind: "idle", message: "실시간 수집 꺼짐" };
}

/** 브라우저(관리자) → 서버 WebSocket 리스너 등록 */
export async function syncToonationListenerFromBrowser(
  alertboxUrl: string,
  options?: {
    userId?: string;
    enabled?: boolean;
    onStatus?: (status: ToonationListenerStatus) => void;
  }
): Promise<ToonationServerStatus> {
  const userId = options?.userId || "";
  const enabled = options?.enabled !== false && Boolean(alertboxUrl.trim());
  options?.onStatus?.({ kind: "syncing", message: "서버에 연동 요청 중…" });

  const q = userId ? `?u=${encodeURIComponent(userId)}` : "";
  const res = await fetch(`/api/donations/toonation/listener${q}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ alertboxUrl: alertboxUrl.trim(), enabled }),
  });
  const data = (await res.json().catch(() => null)) as { status?: ToonationServerStatus; error?: string } | null;
  if (!res.ok) {
    const msg = String(data?.error || res.statusText || "listener_sync_failed");
    options?.onStatus?.({ kind: "error", message: msg });
    throw new Error(msg);
  }
  const status = data?.status ?? null;
  options?.onStatus?.(statusFromServer(status));
  return status;
}

export async function stopToonationListener(userId?: string): Promise<void> {
  const q = userId ? `?u=${encodeURIComponent(userId)}` : "";
  await fetch(`/api/donations/toonation/listener${q}`, {
    method: "DELETE",
    credentials: "include",
  }).catch(() => {});
}

export async function fetchToonationListenerStatus(userId?: string): Promise<ToonationServerStatus> {
  const q = userId ? `?u=${encodeURIComponent(userId)}` : "";
  const res = await fetch(`/api/donations/toonation/listener${q}`, {
    cache: "no-store",
    credentials: "include",
  });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as { status?: ToonationServerStatus } | null;
  return data?.status ?? null;
}

/** @deprecated syncToonationListenerFromBrowser 사용 */
export function startToonationListener(): null {
  return null;
}
