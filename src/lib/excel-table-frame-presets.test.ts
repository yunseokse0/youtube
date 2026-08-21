import { describe, expect, it } from "vitest";
import {
  EXCEL_TABLE_FRAME_PRESETS,
  findExcelTableFramePreset,
  findExcelTableFramePresetByUrl,
} from "./excel-table-frame-presets";

describe("excel-table-frame-presets", () => {
  it("includes golden and candy-canes built-in frames", () => {
    expect(EXCEL_TABLE_FRAME_PRESETS.length).toBeGreaterThanOrEqual(3);
    expect(findExcelTableFramePreset("golden")?.url).toBe("/assets/excel-frames/golden-frame.png");
    expect(findExcelTableFramePreset("candy-canes")?.url).toBe(
      "/assets/excel-frames/candy-canes-frame.png"
    );
    expect(findExcelTableFramePreset("holographic")?.url).toBe(
      "/assets/excel-frames/holographic-frame.png"
    );
  });

  it("finds preset by url", () => {
    expect(findExcelTableFramePresetByUrl("/assets/excel-frames/golden-frame.png")?.id).toBe(
      "golden"
    );
    expect(findExcelTableFramePresetByUrl("")).toBeUndefined();
  });
});
