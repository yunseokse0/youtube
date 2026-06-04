import { describe, expect, it } from "vitest";
import {
  applyEffectRangeToBlocks,
  applyEffectToSegmentRange,
  blocksFromMultilineText,
  lineCharRangeInMultiline,
  lineIndexAtTextOffset,
  multilineTextFromBlocks,
  type ObsTextBlock,
} from "@/lib/obs-text-overlay";

describe("obs text multiline", () => {
  const prev: ObsTextBlock[] = [
    {
      id: "b1",
      segments: [{ text: "첫줄", color: "#ff0000" }],
      visible: true,
      align: "center",
      effect: "pulse",
    },
    {
      id: "b2",
      segments: [{ text: "둘째", color: "#00ff00" }],
      visible: true,
      align: "left",
      effect: "none",
    },
  ];

  it("multilineTextFromBlocks joins lines", () => {
    expect(multilineTextFromBlocks(prev)).toBe("첫줄\n둘째");
  });

  it("blocksFromMultilineText preserves ids and effects", () => {
    const next = blocksFromMultilineText("첫줄\n둘째\n셋째", prev, "#ffffff");
    expect(next).toHaveLength(3);
    expect(next[0].id).toBe("b1");
    expect(next[0].effect).toBe("pulse");
    expect(next[0].segments[0].color).toBe("#ff0000");
    expect(next[2].segments[0].text).toBe("셋째");
  });

  it("lineIndexAtTextOffset", () => {
    expect(lineIndexAtTextOffset("a\nb\nc", 0)).toBe(0);
    expect(lineIndexAtTextOffset("a\nb\nc", 2)).toBe(1);
    expect(lineIndexAtTextOffset("a\nb\nc", 4)).toBe(2);
  });

  it("lineCharRangeInMultiline", () => {
    const r = lineCharRangeInMultiline("hello\nworld", 1);
    expect(r.line).toBe("world");
    expect(r.start).toBe(6);
    expect(r.end).toBe(11);
  });

  it("applyEffectToSegmentRange — partial selection", () => {
    const segs = [{ text: "abcdef", color: "#fff" }];
    const next = applyEffectToSegmentRange(segs, 1, 4, "pulse", 1);
    expect(next.length).toBe(3);
    expect(next[1]?.effect).toBe("pulse");
    expect(next[1]?.text).toBe("bcd");
  });

  it("applyEffectRangeToBlocks — no selection applies to all lines", () => {
    const blocks = blocksFromMultilineText("aa\nbb", prev, "#fff");
    const next = applyEffectRangeToBlocks("aa\nbb", blocks, 0, 0, "glow", 1, "#fff");
    expect(next.every((b) => b.effect === "glow")).toBe(true);
  });

  it("applyEffectRangeToBlocks — selection on one line", () => {
    const blocks = blocksFromMultilineText("hello", [], "#fff");
    const next = applyEffectRangeToBlocks("hello", blocks, 1, 4, "wave", 1.2, "#fff");
    expect(next[0]?.effect).toBe("none");
    expect(next[0]?.segments.some((s) => s.effect === "wave" && s.text === "ell")).toBe(true);
  });
});
