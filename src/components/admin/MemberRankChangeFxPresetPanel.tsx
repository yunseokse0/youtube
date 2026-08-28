"use client";

export type MemberRankChangeFxPresetFields = {
  memberRankChangeFx?: string;
  memberRankChangeNameSize?: string;
  memberRankChangeRankSize?: string;
  memberRankChangeIconSize?: string;
  memberRankChangeNameColor?: string;
  memberRankChangeRankColor?: string;
  memberRankChangeAccentColor?: string;
  memberRankChangeCardBg?: string;
  memberRankChangeCardBorder?: string;
  memberRankChangeConfettiColors?: string;
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

type Props = {
  preset: MemberRankChangeFxPresetFields;
  onChange: (patch: Partial<MemberRankChangeFxPresetFields>) => void;
  compact?: boolean;
  className?: string;
};

export function MemberRankChangeFxPresetPanel({ preset, onChange, compact = false, className = "" }: Props) {
  const p = preset;
  const fxOff = String(p.memberRankChangeFx || "").trim().toLowerCase() === "off";
  const labelClass = compact ? "text-[10px] text-neutral-400" : "text-xs text-neutral-400";

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <label className={labelClass}>
          연출
          <select
            className="mt-1 w-full rounded border border-white/10 bg-neutral-900/80 px-2 py-1 text-sm"
            value={fxOff ? "off" : "on"}
            onChange={(e) => onChange({ memberRankChangeFx: e.target.value === "off" ? "off" : "" })}
          >
            <option value="on">ON (순위 상승 시 카드 연출)</option>
            <option value="off">OFF</option>
          </select>
        </label>
        <p className={`text-neutral-500 self-end pb-1 ${compact ? "text-[10px]" : "text-[10px]"}`}>
          후원 반영으로 순위가 올라간 멤버 1명에게만 표시됩니다. 하락·동률은 무시.
        </p>
      </div>
      {!fxOff ? (
        <>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            {(
              [
                ["memberRankChangeNameSize", "이름 크기(px)", "28", 12, 72],
                ["memberRankChangeRankSize", "순위 숫자(px)", "80", 32, 160],
                ["memberRankChangeIconSize", "▲ 크기(px)", "30", 12, 80],
              ] as const
            ).map(([key, label, fallback, min, max]) => (
              <label key={key} className={labelClass}>
                {label}
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={1}
                    value={(() => {
                      const n = parseInt(String(p[key] || fallback), 10);
                      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : parseInt(fallback, 10);
                    })()}
                    onChange={(e) => onChange({ [key]: e.target.value })}
                    className="flex-1 accent-amber-500"
                  />
                  <input
                    type="number"
                    min={min}
                    max={max}
                    className="w-14 rounded border border-white/10 bg-neutral-900/80 px-1 py-0.5 text-xs text-center"
                    value={String(p[key] || fallback)}
                    onChange={(e) => onChange({ [key]: e.target.value })}
                  />
                </div>
              </label>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {(
              [
                ["memberRankChangeNameColor", "이름 색", "#ffffff"],
                ["memberRankChangeRankColor", "순위·▲ 색", "#ffd700"],
                ["memberRankChangeAccentColor", "축하 테두리·글로우", "#ffd700"],
              ] as const
            ).map(([key, label, fallback]) => (
              <label key={key} className="text-[10px] text-neutral-500">
                {label}
                <input
                  type="color"
                  className="mt-0.5 h-7 w-full rounded border border-white/10 bg-neutral-900/80 p-0.5"
                  value={toColorPickerValue(String(p[key] || ""), fallback)}
                  onChange={(e) => onChange({ [key]: e.target.value })}
                />
              </label>
            ))}
            <label className="text-[10px] text-neutral-500 md:col-span-3">
              카드 배경 (hex/rgba)
              <input
                type="text"
                className="mt-0.5 w-full rounded border border-white/10 bg-neutral-900/80 px-2 py-1 text-xs font-mono"
                placeholder="rgba(26, 32, 44, 0.92)"
                value={String(p.memberRankChangeCardBg || "")}
                onChange={(e) => onChange({ memberRankChangeCardBg: e.target.value })}
              />
            </label>
            <label className="text-[10px] text-neutral-500 md:col-span-3">
              카드 테두리 (hex/rgba)
              <input
                type="text"
                className="mt-0.5 w-full rounded border border-white/10 bg-neutral-900/80 px-2 py-1 text-xs font-mono"
                placeholder="rgba(77, 166, 255, 0.25)"
                value={String(p.memberRankChangeCardBorder || "")}
                onChange={(e) => onChange({ memberRankChangeCardBorder: e.target.value })}
              />
            </label>
            <label className="text-[10px] text-neutral-500 md:col-span-3">
              confetti 색 (쉼표 구분)
              <input
                type="text"
                className="mt-0.5 w-full rounded border border-white/10 bg-neutral-900/80 px-2 py-1 text-xs font-mono"
                placeholder="#ffd700,#ffffff,#4da6ff,#00e676"
                value={String(p.memberRankChangeConfettiColors || "")}
                onChange={(e) => onChange({ memberRankChangeConfettiColors: e.target.value })}
              />
            </label>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function MemberRankChangeFxPresetPanelHeader({ compact = false }: { compact?: boolean }) {
  return (
    <div>
      <h4 className={compact ? "text-xs font-semibold text-amber-100" : "text-sm font-semibold text-amber-100"}>
        엑셀표 · 순위 변동 연출 (멤버 순위 상승 시)
      </h4>
      <p className={`mt-1 text-neutral-400 leading-snug ${compact ? "text-[10px]" : "text-[11px]"}`}>
        엑셀표 멤버 순위가 올라갈 때 카드·confetti 연출. OBS 전용 URL{" "}
        <code className="text-neutral-300">/overlay/rank-change</code> 또는 통합{" "}
        <code className="text-neutral-300">/overlay</code>. 저장 즉시 반영(URL 재복사 불필요).
      </p>
    </div>
  );
}
