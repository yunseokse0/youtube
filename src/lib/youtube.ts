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

// 간단한 메모리 캐시 구현
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

const MEMORY_CACHE_TTL = 5 * 60 * 1000; // 5분
const viewersCache = new Map<string, CacheEntry<number | null>>();
const liveChatCache = new Map<string, CacheEntry<string | null>>();

function getCacheKey(type: string, id: string): string {
  return `yt_cache_${type}_${id}`;
}

function getFromCache<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  
  return entry.data;
}

function setCache<T>(cache: Map<string, CacheEntry<T>>, key: string, data: T, ttl: number = MEMORY_CACHE_TTL): void {
  cache.set(key, {
    data,
    timestamp: Date.now(),
    expiresAt: Date.now() + ttl
  });
}

// 캐시 통계 조회
export function getCacheStats(): { viewers: number; livechat: number } {
  return {
    viewers: viewersCache.size,
    livechat: liveChatCache.size
  };
}

export async function fetchLiveChatIdByVideoId(videoId: string): Promise<string | null> {
  const API_KEY = getPreferredApiKey();
  
  // 캐시 확인
  const cacheKey = getCacheKey('livechat', videoId);
  const cached = getFromCache(liveChatCache, cacheKey);
  if (cached !== null) {
    console.log(`[YouTube API] LiveChat ID 캐시 적중: ${cached}`);
    return cached;
  }

  if (!API_KEY) {
    console.log("[YouTube API] API 키가 없습니다, 웹 스크래핑 시도");
    // API 키가 없으면 웹 스크래핑 시도
    const { scrapeLiveChatId } = await import('./youtube-scraper');
    const scrapedId = await scrapeLiveChatId(videoId);
    if (scrapedId) {
      setCache(liveChatCache, cacheKey, scrapedId);
    }
    return scrapedId;
  }

  try {
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "liveStreamingDetails");
    url.searchParams.set("id", videoId);
    url.searchParams.set("key", API_KEY);
    console.log(`[YouTube API] LiveChat ID 요청: ${videoId}`);
    const r = await fetch(url.toString());
    console.log(`[YouTube API] 응답 상태: ${r.status}`);
    if (!r.ok) {
      console.log(`[YouTube API] 요청 실패: ${r.status} ${r.statusText}, 웹 스크래핑 시도`);
      // API 실패 시 웹 스크래핑 시도
      const { scrapeLiveChatId } = await import('./youtube-scraper');
      const scrapedId = await scrapeLiveChatId(videoId);
      if (scrapedId) {
        setCache(liveChatCache, cacheKey, scrapedId);
      }
      return scrapedId;
    }
    const data = await r.json();
    console.log(`[YouTube API] 응답 데이터:`, data);
    const id = data?.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
    console.log(`[YouTube API] LiveChat ID 추출 결과: ${id}`);
    
    // 캐시 저장
    if (id) {
      setCache(liveChatCache, cacheKey, id);
    }
    
    return id || null;
  } catch (error) {
    console.error("[YouTube API] LiveChat ID 추출 오류:", error);
    console.log("[YouTube API] 웹 스크래핑 시도");
    // API 실패 시 웹 스크래핑 시도
    const { scrapeLiveChatId } = await import('./youtube-scraper');
    const scrapedId = await scrapeLiveChatId(videoId);
    if (scrapedId) {
      setCache(liveChatCache, cacheKey, scrapedId);
    }
    return scrapedId;
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
  
  // 캐시 확인
  const cacheKey = getCacheKey('viewers', videoId);
  const cached = getFromCache(viewersCache, cacheKey);
  if (cached !== null) {
    console.log(`[YouTube API] 시청자 수 캐시 적중: ${cached}`);
    return cached;
  }

  if (!API_KEY) {
    console.log("[YouTube API] 시청자 수 API 키가 없습니다, 웹 스크래핑 시도");
    // API 키가 없으면 웹 스크래핑 시도
    const { scrapeConcurrentViewers } = await import('./youtube-scraper');
    const scrapedViewers = await scrapeConcurrentViewers(videoId);
    if (scrapedViewers !== null) {
      setCache(viewersCache, cacheKey, scrapedViewers);
    }
    return scrapedViewers;
  }

  try {
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "liveStreamingDetails");
    url.searchParams.set("id", videoId);
    url.searchParams.set("key", API_KEY);
    console.log(`[YouTube API] 시청자 수 요청: ${videoId}`);
    const r = await fetch(url.toString());
    console.log(`[YouTube API] 시청자 수 응답 상태: ${r.status}`);
    if (!r.ok) {
      console.log(`[YouTube API] 시청자 수 요청 실패: ${r.status} ${r.statusText}, 웹 스크래핑 시도`);
      // API 실패 시 웹 스크래핑 시도
      const { scrapeConcurrentViewers } = await import('./youtube-scraper');
      const scrapedViewers = await scrapeConcurrentViewers(videoId);
      if (scrapedViewers !== null) {
        setCache(viewersCache, cacheKey, scrapedViewers);
      }
      return scrapedViewers;
    }
    const data = await r.json();
    console.log(`[YouTube API] 시청자 수 응답 데이터:`, data);
    const v = data?.items?.[0]?.liveStreamingDetails?.concurrentViewers;
    console.log(`[YouTube API] 시청자 수 추출 결과: ${v}`);
    if (v == null) return null;
    const n = Number(v);
    const result = Number.isFinite(n) ? n : null;
    
    // 캐시 저장
    if (result !== null) {
      setCache(viewersCache, cacheKey, result);
    }
    
    return result;
  } catch (error) {
    console.error("[YouTube API] 시청자 수 추출 오류:", error);
    console.log("[YouTube API] 웹 스크래핑 시도");
    // API 실패 시 웹 스크래핑 시도
    const { scrapeConcurrentViewers } = await import('./youtube-scraper');
    const scrapedViewers = await scrapeConcurrentViewers(videoId);
    if (scrapedViewers !== null) {
      setCache(viewersCache, cacheKey, scrapedViewers);
    }
    return scrapedViewers;
  }
}

export function startViewersPolling(videoId: string, onSample: (n: number | null) => void, intervalMs = 60_000) { // 10초 → 60초로 기본값 증가
  let running = true;
  let quotaExceeded = false;
  let retryCount = 0;
  const maxRetries = 3;
  let lastUpdate = 0;

  const loop = async () => {
    if (!running) return;
    
    // 할당량 초과 시 재시도 간격 증가
    if (quotaExceeded) {
      const backoffMs = Math.min(300000, 60000 * Math.pow(2, retryCount)); // 지수 백오프
      console.log(`[YouTube API] 할당량 초과로 ${backoffMs/1000}초 후 재시도`);
      setTimeout(loop, backoffMs);
      retryCount++;
      return;
    }
    
    try {
      const now = Date.now();
      const cacheKey = getCacheKey('viewers', videoId);
      const cached = getFromCache(viewersCache, cacheKey);
      
      // 캐시된 데이터가 있고 갱신 시간이 덜 지났으면 즉시 반환
      if (cached !== null && (now - lastUpdate) < intervalMs / 2) {
        console.log(`[YouTube API] 시청자 수 캐시 사용: ${cached}`);
        onSample(cached);
        setTimeout(loop, Math.max(2_000, intervalMs));
        return;
      }
      
      const n = await fetchConcurrentViewers(videoId);
      
      if (n === null) {
        // API 호출 실패 시 할당량 문제로 간주하고 백오프
        quotaExceeded = true;
        console.log(`[YouTube API] API 호출 실패, 할당량 문제로 간주`);
        // 실패 시에도 마지막 캐시된 데이터가 있으면 사용
        if (cached !== null) {
          console.log(`[YouTube API] 실패 시 캐시된 데이터 사용: ${cached}`);
          onSample(cached);
        } else {
          onSample(null);
        }
      } else {
        // 성공 시 재시도 카운트 리셋
        quotaExceeded = false;
        retryCount = 0;
        lastUpdate = now;
        onSample(n);
      }
      
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
  if (!API_KEY || !preferred) {
    console.log(`[YouTube Chat] API_KEY: ${!!API_KEY}, LiveChatId: ${!!preferred}`);
    return () => {};
  }
  console.log(`[YouTube Chat] 채팅 폴링 시작 - LiveChatId: ${preferred}`);
  const controller = new AbortController();
  let nextPageToken: string | undefined;
  let running = true;
  let first = true;
  let quotaExceeded = false;
  let retryCount = 0;
  let consecutiveEmpty = 0;
  const interval = Math.max(2_000, opts?.intervalMs ?? 10_000);
  const initialLimit = Math.min(2000, Math.max(50, opts?.initialLimit ?? 200));
  const maxResults = Math.min(200, Math.max(50, opts?.maxResults ?? 200));
  const seen = new Set<string>();

  const loop = async () => {
    if (!running) return;
    
    // 할당량 초과 시 재시도 간격 증가
    if (quotaExceeded) {
      const backoffMs = Math.min(300000, 60000 * Math.pow(2, retryCount)); // 지수 백오프
      console.log(`[YouTube Chat] 할당량 초과로 ${backoffMs/1000}초 후 재시도`);
      setTimeout(loop, backoffMs);
      retryCount++;
      return;
    }
    
    try {
      const url = new URL("https://www.googleapis.com/youtube/v3/liveChat/messages");
      url.searchParams.set("liveChatId", preferred!);
      url.searchParams.set("part", "snippet,authorDetails");
      if (nextPageToken) url.searchParams.set("pageToken", nextPageToken);
      
      // 연속된 빈 응답 시 결과 수 감소
      const currentMaxResults = consecutiveEmpty > 3 ? Math.min(50, maxResults) : (first ? initialLimit : maxResults);
      url.searchParams.set("maxResults", String(currentMaxResults));
      url.searchParams.set("key", API_KEY!);
      
      console.log(`[YouTube Chat] 채팅 요청 - pageToken: ${nextPageToken || '없음'}, maxResults: ${currentMaxResults}`);
      const resp = await fetch(url.toString(), { signal: controller.signal });
      console.log(`[YouTube Chat] 채팅 응답 상태: ${resp.status}`);
      
      if (!resp.ok) {
        if (resp.status === 403 || resp.status === 429) {
          quotaExceeded = true;
          console.log(`[YouTube Chat] 할당량 초과 감지: ${resp.status}`);
        }
        console.log(`[YouTube Chat] 채팅 요청 실패: ${resp.status} ${resp.statusText}`);
        throw new Error(`YT ${resp.status}`);
      }
      
      const data = await resp.json();
      console.log(`[YouTube Chat] 채팅 응답 데이터 개수: ${data.items?.length || 0}`);
      const items: any[] = data.items || [];
      
      // 연속된 빈 응답 카운트 업데이트
      if (items.length === 0) {
        consecutiveEmpty++;
      } else {
        consecutiveEmpty = 0;
      }
      
      nextPageToken = data.nextPageToken;
      first = false;
      
      // 성공 시 재시도 카운트 리셋
      quotaExceeded = false;
      retryCount = 0;
      
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
      
      // 스마트 폴링 간격 조정
      const pollingMs: number | undefined = data?.pollingIntervalMillis ? parseInt(data.pollingIntervalMillis, 10) : undefined;
      let nextDelay = Math.max(1000, opts?.intervalMs ?? pollingMs ?? interval);
      
      // 연속된 빈 응답 시 폴링 간격 증가
      if (consecutiveEmpty > 5) {
        nextDelay = Math.min(nextDelay * 2, 60000); // 최대 60초로 제한
        console.log(`[YouTube Chat] 연속 빈 응답으로 폴링 간격 증가: ${nextDelay}ms`);
      }
      
      setTimeout(loop, nextDelay);
    } catch {
      if (!running) return;
      // 에러 시에도 연속 카운트 증가
      consecutiveEmpty++;
      setTimeout(loop, interval);
    }
  };
  loop();
  return () => {
    running = false;
    controller.abort();
  };
}
