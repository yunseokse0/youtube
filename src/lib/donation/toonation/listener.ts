"use client";

import { extractToonationLinkKey, normalizeToonationAlertboxUrl } from "./link-key";

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
  ownerName?: string;
  connected: boolean;
  wsPayload?: string;
  lastEventAt?: number;
  lastDonationAt?: number;
  lastError?: string;
  updatedAt: number;
} | null;

const RECENT_INGEST_MS = 120_000;

export function toonationListenerStatusFromServer(
  status: ToonationServerStatus,
  options?: { socketEnabled?: boolean }
): ToonationListenerStatus {
  if (!status) {
    if (options?.socketEnabled) {
      return { kind: "syncing", message: "서버 연동 확인 중…" };
    }
    return { kind: "idle", message: "실시간 수집 꺼짐" };
  }
  const recentIngest =
    typeof status.lastEventAt === "number" && Date.now() - status.lastEventAt < RECENT_INGEST_MS;
  if (status.lastError && !status.connected && !recentIngest) {
    return { kind: "error", message: status.lastError };
  }
  if (status.connected) {
    return { kind: "connected", message: "투네이션 WebSocket 연결됨" };
  }
  if (recentIngest) {
    return {
      kind: "connected",
      message: status.lastDonationAt ? "투네 후원 수신 중(릴레이)" : "투네 이벤트 수신 중(릴레이)",
    };
  }
  if (status.enabled) {
    return { kind: "syncing", message: "연결 중…" };
  }
  return { kind: "idle", message: "실시간 수집 꺼짐" };
}

/** 브라우저(관리자) → 서버 WebSocket 리스너 등록 (연동키만 넣어도 됨) */
export async function syncToonationListenerFromBrowser(
  alertboxUrlOrKey: string,
  options?: {
    userId?: string;
    ownerName?: string;
    enabled?: boolean;
    onStatus?: (status: ToonationListenerStatus) => void;
  }
): Promise<ToonationServerStatus> {
  const userId = options?.userId || "";
  const normalized = normalizeToonationAlertboxUrl(alertboxUrlOrKey);
  const enabled = options?.enabled !== false && Boolean(normalized);
  options?.onStatus?.({ kind: "syncing", message: "서버에 연동 요청 중…" });

  const q = userId ? `?u=${encodeURIComponent(userId)}` : "";
  const res = await fetch(`/api/donations/toonation/listener${q}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      alertboxUrl: normalized || alertboxUrlOrKey.trim(),
      ownerName: String(options?.ownerName || "").trim(),
      enabled,
    }),
  });
  const data = (await res.json().catch(() => null)) as { status?: ToonationServerStatus; error?: string } | null;
  if (!res.ok) {
    const msg = String(data?.error || res.statusText || "listener_sync_failed");
    options?.onStatus?.({ kind: "error", message: msg });
    throw new Error(msg);
  }
  const status = data?.status ?? null;
  options?.onStatus?.(toonationListenerStatusFromServer(status, { socketEnabled: enabled }));
  return status;
}

export async function stopToonationListener(userId?: string): Promise<void> {
  const q = userId ? `?u=${encodeURIComponent(userId)}` : "";
  await fetch(`/api/donations/toonation/listener${q}`, {
    method: "DELETE",
    credentials: "include",
  }).catch(() => {});
}

export type ToonationSettingsSaveExpectation = {
  linkKey: string;
  ownerName: string;
  enabled: boolean;
};

/** POST 후 GET 으로 연동키·채널 주인명·ON/OFF 가 서버에 반영됐는지 확인 */
export function verifyToonationSettingsSaved(
  status: ToonationServerStatus,
  expected: ToonationSettingsSaveExpectation
): { ok: true } | { ok: false; message: string } {
  if (!status) {
    return { ok: false, message: "서버에 저장된 투네 설정을 찾을 수 없습니다." };
  }
  const expectedKey = extractToonationLinkKey(expected.linkKey) || String(expected.linkKey || "").trim();
  const savedKey =
    extractToonationLinkKey(status.alertboxUrl) || String(status.alertboxUrl || "").trim();

  if (expected.enabled && !expectedKey) {
    return { ok: false, message: "실시간 수집 ON 상태에서는 연동키가 필요합니다." };
  }
  if (expectedKey && savedKey !== expectedKey) {
    return {
      ok: false,
      message: `연동키가 서버와 일치하지 않습니다 (서버: ${savedKey || "없음"})`,
    };
  }

  const normOwner = (s: string) => String(s || "").trim().replace(/\s+/g, "").toLowerCase();
  const savedOwner = normOwner(status.ownerName || "");
  const expectedOwner = normOwner(expected.ownerName || "");
  if (expectedOwner && savedOwner !== expectedOwner) {
    return {
      ok: false,
      message: `채널 주인명이 서버와 일치하지 않습니다 (서버: ${status.ownerName || "없음"})`,
    };
  }
  if (!expectedOwner && savedOwner) {
    /** 폼은 비었는데 서버에 이전 값 — 저장 요청 ownerName="" 가 반영 안 된 경우 */
    return {
      ok: false,
      message: `채널 주인명이 서버에 남아 있습니다 (서버: ${status.ownerName})`,
    };
  }

  if (Boolean(status.enabled) !== Boolean(expected.enabled)) {
    return {
      ok: false,
      message: `실시간 수집 상태 불일치 (서버: ${status.enabled ? "ON" : "OFF"})`,
    };
  }

  return { ok: true };
}

export function maskToonationLinkKeyForDisplay(input: string): string {
  const key = extractToonationLinkKey(input) || String(input || "").trim();
  if (!key) return "(미입력)";
  if (key.length <= 12) return key;
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

export async function fetchToonationListenerStatus(userId?: string): Promise<ToonationServerStatus> {
  const q = userId ? `?u=${encodeURIComponent(userId)}` : "";
  try {
    const res = await fetch(`/api/donations/toonation/listener${q}`, {
      cache: "no-store",
      credentials: "include",
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as { status?: ToonationServerStatus } | null;
    return data?.status ?? null;
  } catch {
    return null;
  }
}

export {
  EXAMPLE_TOONATION_LINK_KEY,
  extractToonationLinkKey,
  isExampleToonationLinkKey,
  isToonationLinkKey,
  normalizeToonationAlertboxUrl,
  readToonationAlertboxFromLocal,
  readToonationOwnerFromLocal,
  readToonationSettingsUpdatedAtFromLocal,
  readToonationSocketEnabledFromLocal,
  shouldPreferLocalToonationSettingsOverServer,
  writeToonationSettingsToLocal,
} from "./link-key";
