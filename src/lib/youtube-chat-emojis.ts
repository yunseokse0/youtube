import type { ObsTextSegment } from "@/lib/obs-text-overlay";

/** YouTube 라이브 채팅 공용 이모티콘 — yt3.ggpht.com (brainwo gist 기준, 2024) */

export type YoutubeChatEmojiPreset = {
  code: string;
  label: string;
  url: string;
};

const FACE_RED_HEART_SHAPE =
  "https://yt3.ggpht.com/I0Mem9dU_IZ4a9cQPzR0pUJ8bH-882Eg0sDQjBmPcHA6Oq0uXOZcsjPvPbtormx91Ha2eRA=w24-h24-c-k-nd";

const HANDS_YELLOW_HEART_RED =
  "https://yt3.ggpht.com/qWSu2zrgOKLKgt_E-XUP9e30aydT5aF3TnNjvfBL55cTu1clP8Eoh5exN3NDPEVPYmasmoA=w24-h24-c-k-nd";

export const OBS_TEXT_YOUTUBE_EMOJI_PRESETS: YoutubeChatEmojiPreset[] = [
  { code: ":face-red-heart-shape:", label: "하트 얼굴", url: FACE_RED_HEART_SHAPE },
  { code: ":hands-yellow-heart-red:", label: "손 하트", url: HANDS_YELLOW_HEART_RED },
];

const CODE_SORTED = OBS_TEXT_YOUTUBE_EMOJI_PRESETS.map((p) => p.code).sort(
  (a, b) => b.length - a.length
);

export function buildYoutubeChatEmojiUrl(baseUrl: string, px = 48): string {
  const size = Math.max(16, Math.min(96, Math.floor(px)));
  if (/w\d+-h\d+-c-k-nd/.test(baseUrl)) {
    return baseUrl.replace(/w\d+-h\d+-c-k-nd/, `w${size}-h${size}-c-k-nd`);
  }
  return baseUrl;
}

export function youtubeEmojiPresetForCode(code: string): YoutubeChatEmojiPreset | null {
  const key = String(code || "").trim();
  return OBS_TEXT_YOUTUBE_EMOJI_PRESETS.find((p) => p.code === key) ?? null;
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
      const preset = youtubeEmojiPresetForCode(matched)!;
      segments.push({
        text: matched,
        color: defaultColor,
        imageUrl: buildYoutubeChatEmojiUrl(preset.url, 48),
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
