export type OnForbidden = (matched: { word: string; author: string; message: string }) => void;

const ENV_API_KEY = process.env.NEXT_PUBLIC_YT_API_KEY || process.env.NEXT_PUBLIC_YOUTUBE_API_KEY;
const ENV_LIVE_CHAT_ID = process.env.NEXT_PUBLIC_YT_LIVE_CHAT_ID;
const LIVE_CHAT_ID_KEY = "excel-broadcast-live-chat-id";
const VIDEO_URL_KEY = "excel-broadcast-video-url";
const API_KEY_KEY = "excel-broadcast-yt-api-key";

let aborter: AbortController | null = null;

export function getPreferredLiveChatId(): string | null {
  if (typeof window === "undefined") return ENV_LIVE_CHAT_ID || null;
  return window.localStorage.getItem(LIVE_CHAT_ID_KEY) || ENV_LIVE_CHAT_ID || null;
}

export function getSavedVideoUrl(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(VIDEO_URL_KEY);
}

export function clearPreferredLiveChatId() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(LIVE_CHAT_ID_KEY);
}

export function getPreferredApiKey(): string | null {
  if (typeof window === "undefined") return ENV_API_KEY || null;
  return window.localStorage.getItem(API_KEY_KEY) || ENV_API_KEY || null;
}

export const HAS_ENV_API_KEY: boolean = !!ENV_API_KEY;

export function setPreferredApiKey(key: string) {
  if (typeof window === "undefined") return;
  if (ENV_API_KEY) return; // immutable when provided via env (e.g., Vercel)
  window.localStorage.setItem(API_KEY_KEY, key);
}

export function clearPreferredApiKey() {
  if (typeof window === "undefined") return;
  if (ENV_API_KEY) return; // immutable when provided via env
  window.localStorage.removeItem(API_KEY_KEY);
}

export function parseVideoIdFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") {
      return u.pathname.replace("/", "") || null;
    }
    if (u.hostname.includes("youtube.com")) {
      if (u.pathname === "/watch") {
        return u.searchParams.get("v");
      }
      const liveMatch = u.pathname.match(/\/live\/([A-Za-z0-9_-]{6,})/);
      if (liveMatch) return liveMatch[1];
    }
    return null;
  } catch {
    return null;
  }
}

export async function fetchLiveChatIdByVideoId(videoId: string): Promise<string | null> {
  const API_KEY = getPreferredApiKey();
  if (!API_KEY) return null;
  try {
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "liveStreamingDetails");
    url.searchParams.set("id", videoId);
    url.searchParams.set("key", API_KEY);
    const r = await fetch(url.toString());
    if (!r.ok) return null;
    const data = await r.json();
    const id = data?.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
    return id || null;
  } catch {
    return null;
  }
}

export async function setYoutubeVideoUrl(url: string): Promise<{ liveChatId: string | null; videoId: string | null }> {
  if (typeof window === "undefined") return { liveChatId: null, videoId: null };
  const videoId = parseVideoIdFromUrl(url);
  if (!videoId) {
    window.localStorage.removeItem(VIDEO_URL_KEY);
    return { liveChatId: null, videoId: null };
  }
  window.localStorage.setItem(VIDEO_URL_KEY, url);
  const liveChatId = await fetchLiveChatIdByVideoId(videoId);
  if (liveChatId) {
    window.localStorage.setItem(LIVE_CHAT_ID_KEY, liveChatId);
  }
  return { liveChatId: liveChatId || null, videoId };
}

export async function fetchConcurrentViewers(videoId: string): Promise<number | null> {
  const API_KEY = getPreferredApiKey();
  if (!API_KEY) return null;
  try {
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "liveStreamingDetails");
    url.searchParams.set("id", videoId);
    url.searchParams.set("key", API_KEY);
    const r = await fetch(url.toString());
    if (!r.ok) return null;
    const data = await r.json();
    const v = data?.items?.[0]?.liveStreamingDetails?.concurrentViewers;
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function startViewersPolling(videoId: string, onSample: (n: number | null) => void, intervalMs = 10_000) {
  let running = true;
  const loop = async () => {
    if (!running) return;
    try {
      const n = await fetchConcurrentViewers(videoId);
      onSample(n);
    } finally {
      if (!running) return;
      setTimeout(loop, Math.max(2_000, intervalMs));
    }
  };
  loop();
  return () => { running = false; };
}

export function startYoutubePolling(forbiddenWords: string[], onForbidden: OnForbidden) {
  if (typeof window === "undefined") return () => {};
  const preferred = getPreferredLiveChatId();
  const API_KEY = getPreferredApiKey();
  if (!API_KEY || !preferred) {
    return () => {};
  }
  stopYoutubePolling();
  aborter = new AbortController();
  let nextPageToken: string | undefined;
  let running = true;

  const fetchLoop = async () => {
    if (!running) return;
    try {
      const url = new URL("https://www.googleapis.com/youtube/v3/liveChat/messages");
      url.searchParams.set("liveChatId", preferred!);
      url.searchParams.set("part", "snippet,authorDetails");
      if (nextPageToken) url.searchParams.set("pageToken", nextPageToken);
      url.searchParams.set("key", API_KEY!);
      const resp = await fetch(url.toString(), { signal: aborter!.signal });
      if (!resp.ok) throw new Error(`YT ${resp.status}`);
      const data = await resp.json();
      const items: any[] = data.items || [];
      nextPageToken = data.nextPageToken;
      for (const it of items) {
        const text = it.snippet?.displayMessage || "";
        const author = it.authorDetails?.displayName || "unknown";
        for (const w of forbiddenWords) {
          if (!w) continue;
          const re = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
          if (re.test(text)) {
            onForbidden({ word: w, author, message: text });
            break;
          }
        }
      }
    } catch {
      // ignore, will retry
    } finally {
      if (!running) return;
      setTimeout(fetchLoop, 10_000); // 10s polling
    }
  };
  fetchLoop();
  return () => {
    running = false;
    stopYoutubePolling();
  };
}

export function stopYoutubePolling() {
  if (aborter) {
    aborter.abort();
    aborter = null;
  }
}

export type ChatMessage = {
  id: string;
  at: number;
  author: string;
  message: string;
  owner: boolean;
  moderator: boolean;
  sponsor: boolean;
  verified: boolean;
};
export function startChatPolling(
  onMessage: (msg: ChatMessage) => void,
  opts?: { intervalMs?: number; initialLimit?: number; maxResults?: number }
) {
  if (typeof window === "undefined") return () => {};
  const preferred = getPreferredLiveChatId();
  const API_KEY = getPreferredApiKey();
  if (!API_KEY || !preferred) return () => {};
  const controller = new AbortController();
  let nextPageToken: string | undefined;
  let running = true;
  let first = true;
  const interval = Math.max(2_000, opts?.intervalMs ?? 10_000);
  const initialLimit = Math.min(2000, Math.max(50, opts?.initialLimit ?? 200));
  const maxResults = Math.min(200, Math.max(50, opts?.maxResults ?? 200));
  const seen = new Set<string>();

  const loop = async () => {
    if (!running) return;
    try {
      const url = new URL("https://www.googleapis.com/youtube/v3/liveChat/messages");
      url.searchParams.set("liveChatId", preferred!);
      url.searchParams.set("part", "snippet,authorDetails");
      if (nextPageToken) url.searchParams.set("pageToken", nextPageToken);
      // 항상 넉넉한 결과 수를 요청해 빠르게 들어오는 채팅을 놓치지 않습니다.
      url.searchParams.set("maxResults", String(first ? initialLimit : maxResults));
      url.searchParams.set("key", API_KEY!);
      const resp = await fetch(url.toString(), { signal: controller.signal });
      if (!resp.ok) throw new Error(`YT ${resp.status}`);
      const data = await resp.json();
      const items: any[] = data.items || [];
      nextPageToken = data.nextPageToken;
      first = false;
      for (const it of items) {
        const id: string = it.id || `${it.snippet?.publishedAt}-${it.authorDetails?.channelId}`;
        if (id && seen.has(id)) continue;
        if (id) seen.add(id);
        const text = it.snippet?.displayMessage || "";
        const author = it.authorDetails?.displayName || "unknown";
        const owner = !!it.authorDetails?.isChatOwner;
        const moderator = !!it.authorDetails?.isChatModerator;
        const sponsor = !!it.authorDetails?.isChatSponsor;
        const verified = !!it.authorDetails?.isVerified;
        const publishedAt = it.snippet?.publishedAt ? Date.parse(it.snippet.publishedAt) : Date.now();
        onMessage({ id, at: publishedAt, author, message: text, owner, moderator, sponsor, verified });
      }
      const pollingMs: number | undefined = data?.pollingIntervalMillis ? parseInt(data.pollingIntervalMillis, 10) : undefined;
      const nextDelay = Math.max(1000, opts?.intervalMs ?? pollingMs ?? interval);
      setTimeout(loop, nextDelay);
    } catch {
      if (!running) return;
      setTimeout(loop, interval);
    }
  };
  loop();
  return () => {
    running = false;
    controller.abort();
  };
}
