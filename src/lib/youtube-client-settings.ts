import type { YoutubeClientSettings } from "@/types";
import { defaultState, loadStateFromApi, saveStateAsync } from "@/lib/state";

const API_KEY_KEY = "excel-broadcast-yt-api-key";
const LIVE_CHAT_ID_KEY = "excel-broadcast-live-chat-id";
const VIDEO_URL_KEY = "excel-broadcast-video-url";

let cachedUserId: string | null = null;
let cachedSettings: YoutubeClientSettings = {};

export function getCachedYoutubeClientSettings(): YoutubeClientSettings {
  return cachedSettings;
}

export function setYoutubeClientSettingsUserId(userId: string | null): void {
  cachedUserId = userId ? String(userId).trim() || null : null;
}

export function applyYoutubeClientSettingsCache(settings?: YoutubeClientSettings | null): void {
  cachedSettings = normalizeYoutubeClientSettings(settings);
}

export function normalizeYoutubeClientSettings(
  input: Partial<YoutubeClientSettings> | null | undefined
): YoutubeClientSettings {
  const apiKey = String(input?.apiKey ?? "").trim();
  const liveChatId = String(input?.liveChatId ?? "").trim();
  const videoUrl = String(input?.videoUrl ?? "").trim();
  return {
    ...(apiKey ? { apiKey } : {}),
    ...(liveChatId ? { liveChatId } : {}),
    ...(videoUrl ? { videoUrl } : {}),
  };
}

function readLegacyYoutubeSettingsFromLocalStorage(): YoutubeClientSettings {
  if (typeof window === "undefined") return {};
  try {
    return normalizeYoutubeClientSettings({
      apiKey: window.localStorage.getItem(API_KEY_KEY) || undefined,
      liveChatId: window.localStorage.getItem(LIVE_CHAT_ID_KEY) || undefined,
      videoUrl: window.localStorage.getItem(VIDEO_URL_KEY) || undefined,
    });
  } catch {
    return {};
  }
}

export async function hydrateYoutubeClientSettingsFromServer(
  userId: string
): Promise<YoutubeClientSettings> {
  setYoutubeClientSettingsUserId(userId);
  const state = await loadStateFromApi(userId);
  const fromServer = normalizeYoutubeClientSettings(state?.youtubeClientSettings);
  if (Object.keys(fromServer).length > 0) {
    applyYoutubeClientSettingsCache(fromServer);
    return fromServer;
  }
  const legacy = readLegacyYoutubeSettingsFromLocalStorage();
  if (Object.keys(legacy).length > 0 && state) {
    applyYoutubeClientSettingsCache(legacy);
    await saveStateAsync(
      { ...state, youtubeClientSettings: legacy, updatedAt: Date.now() },
      userId,
      { omitDonationFields: true }
    );
    return legacy;
  }
  applyYoutubeClientSettingsCache({});
  return {};
}

export async function persistYoutubeClientSettingsToServer(
  userId: string,
  patch: Partial<YoutubeClientSettings>
): Promise<boolean> {
  setYoutubeClientSettingsUserId(userId);
  const state = (await loadStateFromApi(userId)) ?? defaultState();
  const next = normalizeYoutubeClientSettings({ ...state.youtubeClientSettings, ...patch });
  const result = await saveStateAsync(
    { ...state, youtubeClientSettings: next, updatedAt: Date.now() },
    userId,
    { omitDonationFields: true }
  );
  if (result.ok) applyYoutubeClientSettingsCache(next);
  return result.ok;
}
