import { describe, expect, it } from "vitest";
import {
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
});
