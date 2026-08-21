/** 엑셀표 PNG 장식 프레임 — 관리자 원클릭 적용 */
export type ExcelTableFramePreset = {
  id: string;
  label: string;
  url: string;
  /** 권장 안쪽 여백(px) */
  defaultInset?: string;
  defaultOpacity?: string;
};

export const EXCEL_TABLE_FRAME_PRESETS: ExcelTableFramePreset[] = [
  {
    id: "golden",
    label: "골든 프레임",
    url: "/assets/excel-frames/golden-frame.png",
    defaultInset: "32",
    defaultOpacity: "100",
  },
  {
    id: "candy-canes",
    label: "캔디 지팡이 (크리스마스)",
    url: "/assets/excel-frames/candy-canes-frame.png",
    defaultInset: "36",
    defaultOpacity: "100",
  },
  {
    id: "holographic",
    label: "홀로그래픽 그라데이션",
    url: "/assets/excel-frames/holographic-frame.png",
    defaultInset: "30",
    defaultOpacity: "100",
  },
  {
    id: "medieval-spiky",
    label: "메디벌 스파이크",
    url: "/assets/excel-frames/medieval-spiky-frame.png",
    defaultInset: "48",
    defaultOpacity: "100",
  },
  {
    id: "medieval-crest",
    label: "메디벌 크레스트",
    url: "/assets/excel-frames/medieval-crest-frame.png",
    defaultInset: "52",
    defaultOpacity: "100",
  },
  {
    id: "medieval-trefoil",
    label: "메디벌 트레포일",
    url: "/assets/excel-frames/medieval-trefoil-frame.png",
    defaultInset: "48",
    defaultOpacity: "100",
  },
];

export function findExcelTableFramePreset(id: string): ExcelTableFramePreset | undefined {
  return EXCEL_TABLE_FRAME_PRESETS.find((p) => p.id === id);
}

export function findExcelTableFramePresetByUrl(url: string): ExcelTableFramePreset | undefined {
  const v = String(url || "").trim();
  if (!v) return undefined;
  return EXCEL_TABLE_FRAME_PRESETS.find((p) => p.url === v);
}
