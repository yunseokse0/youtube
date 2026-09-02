/**
 * 동일 브라우저 여러 탭 — Web Locks 로 주기 작업 1탭만 실행.
 * 리더 탭 결과는 BroadcastChannel 로 형제 탭에 공유.
 */

const STORAGE_HEALTH_CHANNEL = "youtube-storage-health-v1";

export type StorageHealthBroadcast = {
  type: "storage-health-updated";
  userId: string;
  data: unknown;
  at: number;
};

let storageHealthChannel: BroadcastChannel | null = null;

function getStorageHealthChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  if (!storageHealthChannel) {
    try {
      storageHealthChannel = new BroadcastChannel(STORAGE_HEALTH_CHANNEL);
    } catch {
      return null;
    }
  }
  return storageHealthChannel;
}

export function broadcastStorageHealthUpdated(userId: string, data: unknown): void {
  if (typeof window === "undefined") return;
  const payload: StorageHealthBroadcast = {
    type: "storage-health-updated",
    userId,
    data,
    at: Date.now(),
  };
  try {
    getStorageHealthChannel()?.postMessage(payload);
  } catch {
    /* noop */
  }
}

export function subscribeStorageHealthUpdated(
  userId: string,
  handler: (data: unknown) => void
): () => void {
  if (typeof window === "undefined") return () => {};
  const onMessage = (ev: MessageEvent) => {
    const msg = ev.data as StorageHealthBroadcast | null;
    if (!msg || msg.type !== "storage-health-updated") return;
    if (String(msg.userId || "") !== String(userId || "")) return;
    handler(msg.data);
  };
  const channel = getStorageHealthChannel();
  channel?.addEventListener("message", onMessage);
  return () => channel?.removeEventListener("message", onMessage);
}

function sleepMs(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });
}

/**
 * lockName 당 1탭만 intervalMs 간격으로 task 실행.
 * Web Locks 미지원 시 탭마다 실행(구형 Safari 등 — 드묾).
 */
export function startTabLeaderInterval(
  lockName: string,
  intervalMs: number,
  task: () => void | Promise<void>,
  signal: AbortSignal
): void {
  if (typeof window === "undefined") return;

  const loop = async () => {
    while (!signal.aborted) {
      try {
        await task();
      } catch {
        /* noop */
      }
      try {
        await sleepMs(intervalMs, signal);
      } catch {
        break;
      }
    }
  };

  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    void navigator.locks.request(lockName, { signal }, loop);
    return;
  }
  void loop();
}
