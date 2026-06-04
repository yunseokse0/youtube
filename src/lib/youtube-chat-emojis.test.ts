import { describe, expect, it } from "vitest";
import {
  buildYoutubeChatEmojiUrl,
  lineContainsYoutubeEmojiCode,
  parseLineWithYoutubeEmojis,
} from "@/lib/youtube-chat-emojis";

describe("youtube-chat-emojis", () => {
  it("parseLineWithYoutubeEmojis splits shortcodes", () => {
    const segs = parseLineWithYoutubeEmojis(
      "안녕 :face-red-heart-shape: 반가워 :hands-yellow-heart-red:",
      "#ff0000"
    );
    expect(segs).toHaveLength(4);
    expect(segs[0]?.text).toBe("안녕 ");
    expect(segs[1]?.imageUrl).toContain("yt3.ggpht.com");
    expect(segs[1]?.text).toBe(":face-red-heart-shape:");
    expect(segs[3]?.text).toBe(":hands-yellow-heart-red:");
  });

  it("buildYoutubeChatEmojiUrl scales w/h", () => {
    const base =
      "https://yt3.ggpht.com/x=w24-h24-c-k-nd";
    expect(buildYoutubeChatEmojiUrl(base, 48)).toContain("w48-h48");
  });

  it("lineContainsYoutubeEmojiCode", () => {
    expect(lineContainsYoutubeEmojiCode(":face-red-heart-shape:")).toBe(true);
    expect(lineContainsYoutubeEmojiCode("hello")).toBe(false);
  });
});
