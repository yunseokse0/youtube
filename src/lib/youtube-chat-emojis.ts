import type { ObsTextSegment } from "@/lib/obs-text-overlay";
import {
  YOUTUBE_CHAT_EMOJI_ALIASES,
  YOUTUBE_CHAT_EMOJI_ENTRIES,
} from "@/data/youtube-chat-emojis.generated";

/** YouTube 라이브 채팅 공용 이모티콘 — yt3.ggpht.com (brainwo gist 기준) */

export type YoutubeChatEmojiPreset = {
  code: string;
  label: string;
  url: string;
};

const URL_BY_CODE = new Map<string, string>();
for (const [code, url] of YOUTUBE_CHAT_EMOJI_ENTRIES) {
  URL_BY_CODE.set(code, url);
}
for (const [alias, canonical] of Object.entries(YOUTUBE_CHAT_EMOJI_ALIASES)) {
  const url = URL_BY_CODE.get(canonical);
  if (url) URL_BY_CODE.set(alias, url);
}

/** 긴 코드 우선 매칭 (부분 문자열 오인 방지) */
const CODE_SORTED = [...URL_BY_CODE.keys()].sort((a, b) => b.length - a.length);

function labelForYoutubeEmojiCode(code: string): string {
  return code.replace(/^:|:$/g, "").replace(/-/g, " ");
}

/** 관리 화면 빠른 삽입용 (전체 100종은 코드 입력·붙여넣기) */
export const OBS_TEXT_YOUTUBE_EMOJI_PRESETS: YoutubeChatEmojiPreset[] = [
  {
    code: ":face-red-heart-shape:",
    label: "하트 얼굴",
    url: URL_BY_CODE.get(":face-red-heart-shape:") ?? "",
  },
  {
    code: ":hands-yellow-heart-red:",
    label: "손 하트",
    url: URL_BY_CODE.get(":hands-yellow-heart-red:") ?? "",
  },
  {
    code: ":face-red:",
    label: "빨간 얼굴 (별칭)",
    url: URL_BY_CODE.get(":face-red:") ?? "",
  },
].filter((p) => p.url.length > 0);

export function buildYoutubeChatEmojiUrl(baseUrl: string, px = 48): string {
  const size = Math.max(16, Math.min(96, Math.floor(px)));
  if (/w\d+-h\d+-c-k-nd/.test(baseUrl)) {
    return baseUrl.replace(/w\d+-h\d+-c-k-nd/, `w${size}-h${size}-c-k-nd`);
  }
  return baseUrl;
}

export function youtubeEmojiUrlForCode(code: string): string | null {
  const key = String(code || "").trim();
  return URL_BY_CODE.get(key) ?? null;
}

export function youtubeEmojiPresetForCode(code: string): YoutubeChatEmojiPreset | null {
  const key = String(code || "").trim();
  const url = youtubeEmojiUrlForCode(key);
  if (!url) return null;
  return { code: key, label: labelForYoutubeEmojiCode(key), url };
}

/** 한 줄 문자열에서 :face-red-heart-shape: 등 → 이미지 세그먼트 */
export function parseLineWithYoutubeEmojis(line: string, defaultColor: string): ObsTextSegment[] {
  const normalized = line.length === 0 ? " " : line;
  const segments: ObsTextSegment[] = [];
  let pos = 0;

  while (pos < normalized.length) {
    let matched: string | null = null;
    for (const code of CODE_SORTED) {
      if (normalized.startsWith(code, pos)) {
        matched = code;
        break;
      }
    }
    if (matched) {
      const url = youtubeEmojiUrlForCode(matched)!;
      segments.push({
        text: matched,
        color: defaultColor,
        imageUrl: buildYoutubeChatEmojiUrl(url, 48),
      });
      pos += matched.length;
      continue;
    }

    let nextCodeAt = normalized.length;
    for (const code of CODE_SORTED) {
      const idx = normalized.indexOf(code, pos);
      if (idx >= pos && idx < nextCodeAt) nextCodeAt = idx;
    }
    if (nextCodeAt > pos) {
      segments.push({ text: normalized.slice(pos, nextCodeAt), color: defaultColor });
      pos = nextCodeAt;
    } else {
      segments.push({ text: normalized[pos] ?? " ", color: defaultColor });
      pos += 1;
    }
  }

  return segments.length > 0 ? segments : [{ text: " ", color: defaultColor }];
}

export function lineContainsYoutubeEmojiCode(line: string): boolean {
  return CODE_SORTED.some((code) => line.includes(code));
}
