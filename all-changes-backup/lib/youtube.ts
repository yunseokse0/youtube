export type OnForbidden = (matched: { word: string; author: string; message: string }) => void;

const ENV_API_KEY = process.env.NEXT_PUBLIC_YT_API_KEY;
const ENV_LIVE_CHAT_ID = process.env.NEXT_PUBLIC_YT_LIVE_CHAT_ID;

export const HAS_ENV_API_KEY = !!ENV_API_KEY;
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

export function setPreferredApiKey(key: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(API_KEY_KEY, key);
}

export function clearPreferredApiKey() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(API_KEY_KEY);
}

export function setYoutubeVideoUrl(url: string) {
  if (typeof window === "undefined") return;
  if (!url) {
    window.localStorage.removeItem(VIDEO_URL_KEY);
    clearPreferredLiveChatId();
    return;
  }
  window.localStorage.setItem(VIDEO_URL_KEY, url);
}

function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com")) return u.searchParams.get("v");
    if (u.hostname === "youtu.be") return u.pathname.slice(1);
  } catch {}
  return null;
}

async function fetchLiveChatId(videoId: string, apiKey: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&part=liveStreamingDetails&key=${apiKey}`
    );
    const data = await res.json();
    return data.items?.[0]?.liveStreamingDetails?.activeLiveChatId || null;
  } catch {
    return null;
  }
}

async function fetchLiveChatMessages(
  liveChatId: string,
  apiKey: string,
  pageToken?: string
): Promise<{ items: any[]; nextPageToken?: string; pollingIntervalMillis: number }> {
  const url = new URL("https://www.googleapis.com/youtube/v3/liveChat/messages");
  url.searchParams.set("liveChatId", liveChatId);
  url.searchParams.set("part", "snippet,authorDetails");
  url.searchParams.set("key", apiKey);
  if (pageToken) url.searchParams.set("pageToken", pageToken);

  const res = await fetch(url.toString());
  return await res.json();
}

export function startYoutubePolling(
  videoUrl: string,
  apiKey: string,
  onDonation: (author: string, amount: number, message: string) => void,
  onForbidden: OnForbidden,
  forbiddenWords: string[] = []
) {
  if (aborter) aborter.abort();
  aborter = new AbortController();

  const videoId = extractVideoId(videoUrl);
  if (!videoId) return () => {};

  let liveChatId: string | null = null;
  let pageToken: string | undefined = undefined;

  const signal = aborter.signal;

  const poll = async () => {
    if (signal.aborted) return;

    try {
      if (!liveChatId) {
        liveChatId = await fetchLiveChatId(videoId, apiKey);
        if (liveChatId) {
          if (typeof window !== "undefined") {
            window.localStorage.setItem(LIVE_CHAT_ID_KEY, liveChatId);
          }
        }
      }

      if (!liveChatId) {
        setTimeout(poll, 5000);
        return;
      }

      const data = await fetchLiveChatMessages(liveChatId, apiKey, pageToken);
      pageToken = data.nextPageToken;

      for (const item of data.items) {
        const msg = item.snippet?.displayMessage || "";
        const author = item.authorDetails?.displayName || "익명";

        // 금지어 체크
        for (const word of forbiddenWords) {
          if (msg.toLowerCase().includes(word.toLowerCase())) {
            onForbidden({ word, author, message: msg });
            break;
          }
        }

        // 후원 파싱 (예: "1만원", "5000원" 등)
        const donationMatch = msg.match(/(\d+(?:,\d{3})*)(?:\s*원)?/);
        if (donationMatch) {
          const amount = parseInt(donationMatch[1].replace(/,/g, ""), 10);
          if (amount > 0) {
            onDonation(author, amount, msg);
          }
        }
      }

      setTimeout(poll, data.pollingIntervalMillis || 5000);
    } catch {
      setTimeout(poll, 10000);
    }
  };

  poll();

  return () => {
    if (aborter) {
      aborter.abort();
      aborter = null;
    }
  };
}

export function parseVideoIdFromUrl(url: string): string | null {
  return extractVideoId(url);
}

export async function getLiveChatInfo(videoUrl: string, apiKey: string): Promise<{ videoId: string | null; liveChatId: string | null }> {
  const videoId = extractVideoId(videoUrl);
  if (!videoId) return { videoId: null, liveChatId: null };
  
  const liveChatId = await fetchLiveChatId(videoId, apiKey);
  return { videoId, liveChatId };
}

export function startViewersPolling(videoId: string, onUpdate: (viewers: number) => void) {
  // Placeholder implementation - in a real app, you'd fetch actual viewer data
  return () => {}; // Return cleanup function
}

export function startChatPolling(liveChatId: string, apiKey: string, onMessage: (msg: any) => void) {
  // Placeholder implementation - in a real app, you'd fetch actual chat messages
  return () => {}; // Return cleanup function
}

export function getCacheStats() {
  return {
    viewers: 0,
    livechat: 0
  };
}