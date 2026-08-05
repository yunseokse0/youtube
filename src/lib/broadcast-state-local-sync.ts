import { loadState, storageKey, type AppState } from "@/lib/state";

export const BROADCAST_STATE_LOCAL_UPDATED = "broadcast-state-local-updated";
export const OVERLAY_PRESETS_LOCAL_UPDATED = "overlay-presets-local-updated";
const BROADCAST_CHANNEL_NAME = "excel-broadcast-state-v1";

export type BroadcastStateLocalUpdatedDetail = {
  userId?: string | null;
  updatedAt?: number;
};

let broadcastChannel: BroadcastChannel | null = null;

function getBroadcastChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  if (!broadcastChannel) {
    try {
      broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    } catch {
      return null;
    }
  }
  return broadcastChannel;
}

export function normalizeOverlayUserId(userId?: string | null): string {
  const v = String(userId || "").trim();
  return v || "finalent";
}

export function overlayUserIdsMatch(
  overlayUserId: string | undefined,
  eventUserId: string | null | undefined
): boolean {
  return normalizeOverlayUserId(overlayUserId) === normalizeOverlayUserId(eventUserId);
}

export function notifyBroadcastStateLocalUpdated(
  userId?: string | null,
  updatedAt?: number
): void {
  if (typeof window === "undefined") return;
  const detail: BroadcastStateLocalUpdatedDetail = {
    userId: userId ?? null,
    updatedAt: updatedAt ?? Date.now(),
  };
  window.dispatchEvent(
    new CustomEvent<BroadcastStateLocalUpdatedDetail>(BROADCAST_STATE_LOCAL_UPDATED, { detail })
  );
  try {
    getBroadcastChannel()?.postMessage({ type: BROADCAST_STATE_LOCAL_UPDATED, ...detail });
  } catch {
    /* noop */
  }
  /** 같은 탭 미리보기 iframe은 CustomEvent·BroadcastChannel을 못 받는 경우가 있어 postMessage로도 전달 */
  try {
    const origin = window.location.origin;
    const payload = { type: BROADCAST_STATE_LOCAL_UPDATED, ...detail };
    document.querySelectorAll("iframe").forEach((frame) => {
      try {
        frame.contentWindow?.postMessage(payload, origin);
      } catch {
        /* noop */
      }
    });
  } catch {
    /* noop */
  }
}

export function notifyOverlayPresetsLocalUpdated(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OVERLAY_PRESETS_LOCAL_UPDATED));
  try {
    getBroadcastChannel()?.postMessage({ type: OVERLAY_PRESETS_LOCAL_UPDATED });
  } catch {
    /* noop */
  }
  /** 같은 탭 iframe은 CustomEvent를 못 받으므로 postMessage로도 전달 */
  try {
    const origin = window.location.origin;
    document.querySelectorAll("iframe").forEach((frame) => {
      try {
        frame.contentWindow?.postMessage({ type: OVERLAY_PRESETS_LOCAL_UPDATED }, origin);
      } catch {
        /* noop */
      }
    });
  } catch {
    /* noop */
  }
}

export function readLocalBroadcastState(userId?: string): AppState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return null;
    return loadState(userId ?? undefined);
  } catch {
    return null;
  }
}

export function subscribeBroadcastStateLocalUpdated(
  handler: (detail: BroadcastStateLocalUpdatedDetail) => void
): () => void {
  if (typeof window === "undefined") return () => {};
  const onWindow = (ev: Event) => {
    const detail = (ev as CustomEvent<BroadcastStateLocalUpdatedDetail>).detail || {};
    handler(detail);
  };
  const onChannel = (ev: MessageEvent) => {
    const data = ev.data as { type?: string; userId?: string | null; updatedAt?: number } | null;
    if (!data || data.type !== BROADCAST_STATE_LOCAL_UPDATED) return;
    handler({ userId: data.userId ?? null, updatedAt: data.updatedAt });
  };
  const onFrameMessage = (ev: MessageEvent) => {
    if (ev.origin !== window.location.origin) return;
    const data = ev.data as { type?: string; userId?: string | null; updatedAt?: number } | null;
    if (!data || data.type !== BROADCAST_STATE_LOCAL_UPDATED) return;
    handler({ userId: data.userId ?? null, updatedAt: data.updatedAt });
  };
  window.addEventListener(BROADCAST_STATE_LOCAL_UPDATED, onWindow);
  window.addEventListener("message", onFrameMessage);
  const channel = getBroadcastChannel();
  channel?.addEventListener("message", onChannel);
  return () => {
    window.removeEventListener(BROADCAST_STATE_LOCAL_UPDATED, onWindow);
    window.removeEventListener("message", onFrameMessage);
    channel?.removeEventListener("message", onChannel);
  };
}

export function subscribeOverlayPresetsLocalUpdated(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onWindow = () => handler();
  const onChannel = (ev: MessageEvent) => {
    const data = ev.data as { type?: string } | null;
    if (data?.type === OVERLAY_PRESETS_LOCAL_UPDATED) handler();
  };
  const onFrameMessage = (ev: MessageEvent) => {
    if (ev.origin !== window.location.origin) return;
    const data = ev.data as { type?: string } | null;
    if (data?.type === OVERLAY_PRESETS_LOCAL_UPDATED) handler();
  };
  window.addEventListener(OVERLAY_PRESETS_LOCAL_UPDATED, onWindow);
  window.addEventListener("message", onFrameMessage);
  const channel = getBroadcastChannel();
  channel?.addEventListener("message", onChannel);
  return () => {
    window.removeEventListener(OVERLAY_PRESETS_LOCAL_UPDATED, onWindow);
    window.removeEventListener("message", onFrameMessage);
    channel?.removeEventListener("message", onChannel);
  };
}
