"use client";

import {
  resolveTableThemeRowStripeCss,
  resolveTableThemeRowStripePreviewHex,
  tableRowStripeBgFromPickerHex,
} from "@/lib/excel-member-table-theme";

export type ExcelMemberPillBgPresetFields = {
  tableRowEvenBg?: string;
  tableRowOddBg?: string;
  membersTheme?: string;
  theme?: string;
};

function toColorPickerValue(raw?: string, fallback = "#ffffff") {
  const v = (raw || "").trim();
  const lower = v.toLowerCase();
  if (!v || lower === "transparent" || lower === "none") return fallback;
  const m = v.match(/^#([0-9a-fA-F]{6})$/);
  if (m) return `#${m[1].toLowerCase()}`;
  const rgba = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgba) {
    const toHex = (n: string) =>
      Math.max(0, Math.min(255, parseInt(n, 10)))
        .toString(16)
        .padStart(2, "0");
    return `#${toHex(rgba[1])}${toHex(rgba[2])}${toHex(rgba[3])}`;
  }
  return fallback;
}

export function isExcelMemberPillBgEnabled(
  preset: ExcelMemberPillBgPresetFields,
  themeId: string
): boolean {
  const even = String(preset.tableRowEvenBg || "").trim().toLowerCase();
  const odd = String(preset.tableRowOddBg || "").trim().toLowerCase();
  if (even === "transparent" || odd === "transparent") return false;
  const resolvedOdd = odd || resolveTableThemeRowStripeCss(themeId, "odd");
  return Boolean(resolvedOdd && resolvedOdd !== "transparent");
}

type Props = {
  preset: ExcelMemberPillBgPresetFields;
  themeId: string;
  onChange: (patch: Partial<ExcelMemberPillBgPresetFields>) => void;
};

export function ExcelMemberPillBgPresetPanelHeader() {
  return (
    <div>
      <h4 className="text-sm font-semibold text-emerald-100">엑셀표 · 행 알약 배경</h4>
      <p className="mt-1 text-[11px] leading-snug text-neutral-400">
        멤버 행마다 둥근 알약(pill) 배경을 켜거나 끕니다. 골드 엑셀(
        <code className="text-neutral-300">excelGold</code>) 테마에서 특히 눈에 띕니다. 저장 즉시 OBS 반영.
      </p>
    </div>
  );
}

export function ExcelMemberPillBgPresetPanel({ preset, themeId, onChange }: Props) {
  const pillOn = isExcelMemberPillBgEnabled(preset, themeId);
  const evenPreview = resolveTableThemeRowStripePreviewHex(themeId, "even");
  const oddPreview = resolveTableThemeRowStripePreviewHex(themeId, "odd");

  return (
    <div className="space-y-3">
      <label className="text-xs text-neutral-400">
        알약 배경
        <select
          className="mt-1 w-full max-w-xs rounded border border-white/10 bg-neutral-900/80 px-2 py-1.5 text-sm"
          value={pillOn ? "on" : "off"}
          onChange={(e) => {
            if (e.target.value === "off") {
              onChange({ tableRowEvenBg: "transparent", tableRowOddBg: "transparent" });
            } else {
              onChange({ tableRowEvenBg: "", tableRowOddBg: "" });
            }
          }}
        >
          <option value="on">ON (행마다 둥근 배경)</option>
          <option value="off">OFF (투명 · 알약 없음)</option>
        </select>
      </label>
      {pillOn ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="text-[11px] text-neutral-400">
            짝 행(2·4·6…) 배경
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
              <input
                type="color"
                className="h-9 w-14 shrink-0 cursor-pointer rounded border border-white/10 bg-neutral-900/80 p-1"
                value={toColorPickerValue(preset.tableRowEvenBg, evenPreview)}
                onChange={(e) =>
                  onChange({ tableRowEvenBg: tableRowStripeBgFromPickerHex(e.target.value, 0.08) })
                }
              />
              <input
                className="min-w-0 flex-1 rounded border border-white/10 bg-neutral-900/80 px-2 py-1 font-mono text-xs"
                value={preset.tableRowEvenBg || ""}
                onChange={(e) => onChange({ tableRowEvenBg: e.target.value })}
                placeholder="비우면 테마 자동"
              />
              <button
                type="button"
                className="shrink-0 rounded bg-neutral-800 px-2 py-1 text-xs hover:bg-neutral-700"
                onClick={() => onChange({ tableRowEvenBg: "" })}
              >
                테마 자동
              </button>
            </div>
          </label>
          <label className="text-[11px] text-neutral-400">
            홀 행(1·3·5…) 배경
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
              <input
                type="color"
                className="h-9 w-14 shrink-0 cursor-pointer rounded border border-white/10 bg-neutral-900/80 p-1"
                value={toColorPickerValue(preset.tableRowOddBg, oddPreview)}
                onChange={(e) =>
                  onChange({ tableRowOddBg: tableRowStripeBgFromPickerHex(e.target.value, 0.16) })
                }
              />
              <input
                className="min-w-0 flex-1 rounded border border-white/10 bg-neutral-900/80 px-2 py-1 font-mono text-xs"
                value={preset.tableRowOddBg || ""}
                onChange={(e) => onChange({ tableRowOddBg: e.target.value })}
                placeholder="비우면 테마 자동"
              />
              <button
                type="button"
                className="shrink-0 rounded bg-neutral-800 px-2 py-1 text-xs hover:bg-neutral-700"
                onClick={() => onChange({ tableRowOddBg: "" })}
              >
                테마 자동
              </button>
            </div>
          </label>
        </div>
      ) : (
        <p className="text-[10px] text-neutral-500">
          OFF 상태입니다. ON으로 바꾸면 테마 기본 알약 색이 적용됩니다. 골드 엑셀은 흰색 반투명 줄무늬가 기본입니다.
        </p>
      )}
    </div>
  );
}
