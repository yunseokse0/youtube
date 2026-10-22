import type { ObsTextSegment } from "@/lib/obs-text-overlay";
import {
  KOREAN_BANK_LOGO_CODES_SORTED,
  koreanBankLogoUrlForCode,
  lineContainsKoreanBankLogoCode,
} from "@/lib/korean-bank-logos";
import {
  buildYoutubeChatEmojiUrl,
  lineContainsYoutubeEmojiCode,
  youtubeEmojiUrlForCode,
} from "@/lib/youtube-chat-emojis";
import { YOUTUBE_CHAT_EMOJI_ENTRIES, YOUTUBE_CHAT_EMOJI_ALIASES } from "@/data/youtube-chat-emojis.generated";

/** 유튜브 채팅 이모지 + 은행 로고 단축코드를 한 줄에서 imageUrl 세그먼트로 변환 */

const YT_CODES = (() => {
  const set = new Set<string>();
  for (const [code] of YOUTUBE_CHAT_EMOJI_ENTRIES) set.add(code);
  for (const alias of Object.keys(YOUTUBE_CHAT_EMOJI_ALIASES)) set.add(alias);
  return [...set].sort((a, b) => b.length - a.length);
})();

const ALL_CODES_SORTED = [...new Set([...YT_CODES, ...KOREAN_BANK_LOGO_CODES_SORTED])].sort(
  (a, b) => b.length - a.length
);

function imageUrlForInlineCode(code: string): string | null {
  const bank = koreanBankLogoUrlForCode(code);
  if (bank) return bank;
  const yt = youtubeEmojiUrlForCode(code);
  if (yt) return buildYoutubeChatEmojiUrl(yt, 48);
  return null;
}

export function lineContainsObsTextInlineMedia(line: string): boolean {
  return lineContainsYoutubeEmojiCode(line) || lineContainsKoreanBankLogoCode(line);
}

/** 한 줄 문자열에서 :face-red-heart-shape: · :bank-kb: 등 → 이미지 세그먼트 */
export function parseObsTextLineWithInlineMedia(
  line: string,
  defaultColor: string
): ObsTextSegment[] {
  const normalized = line.length === 0 ? " " : line;
  const segments: ObsTextSegment[] = [];
  let pos = 0;

  while (pos < normalized.length) {
    let matched: string | null = null;
    for (const code of ALL_CODES_SORTED) {
      if (normalized.startsWith(code, pos)) {
        matched = code;
        break;
      }
    }
    if (matched) {
      const url = imageUrlForInlineCode(matched);
      if (url) {
        segments.push({
          text: matched,
          color: defaultColor,
          imageUrl: url,
        });
      } else {
        segments.push({ text: matched, color: defaultColor });
      }
      pos += matched.length;
      continue;
    }

    let nextCodeAt = normalized.length;
    for (const code of ALL_CODES_SORTED) {
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
