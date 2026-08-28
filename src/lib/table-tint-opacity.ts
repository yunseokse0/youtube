/**
 * 엑셀표 「표 배경 불투명도」(0~100%)를 헤더·줄무늬·시트 색에 반영.
 * - rgba 줄무늬는 기존 알파 × 슬라이더 (100%면 원색 유지)
 * - hex/rgb 단색은 슬라이더 값을 알파로 사용
 */

function clampAlpha(alpha: number): number {
  return Math.max(0, Math.min(1, alpha));
}

function parseHexRgb(hex: string): [number, number, number] | null {
  const norm = hex.trim();
  if (!/^#[0-9a-fA-F]{3,8}$/.test(norm)) return null;
  if (norm.length === 4) {
    return [
      parseInt(norm[1] + norm[1], 16),
      parseInt(norm[2] + norm[2], 16),
      parseInt(norm[3] + norm[3], 16),
    ];
  }
  if (norm.length >= 7) {
    return [
      parseInt(norm.slice(1, 3), 16),
      parseInt(norm.slice(3, 5), 16),
      parseInt(norm.slice(5, 7), 16),
    ];
  }
  return null;
}

/** 단색(hex/rgb) — 슬라이더 알파를 그대로 적용 */
export function applySolidTableTintToCssColor(input: string, tintAlpha: number): string {
  const t = (input || "").trim();
  if (!t || t.toLowerCase() === "transparent") return "transparent";
  const a = clampAlpha(tintAlpha);
  if (a <= 0) return "transparent";

  const rgbaMatch = t.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+)?\s*\)$/i);
  if (rgbaMatch) {
    return a >= 1
      ? `rgb(${rgbaMatch[1]}, ${rgbaMatch[2]}, ${rgbaMatch[3]})`
      : `rgba(${rgbaMatch[1]}, ${rgbaMatch[2]}, ${rgbaMatch[3]}, ${a})`;
  }
  const hex = t.startsWith("#") ? t : `#${t}`;
  const rgb = parseHexRgb(hex);
  if (rgb) {
    return a >= 1 ? `rgb(${rgb.join(", ")})` : `rgba(${rgb.join(", ")}, ${a})`;
  }
  return t;
}

/**
 * 헤더·줄무늬 등 — rgba는 기존 알파와 슬라이더를 곱함.
 * 100%일 때 줄무늬 rgba(…, 0.14)는 그대로 유지.
 */
export function applyTableTintToCssColor(input: string, tintAlpha: number): string {
  const t = (input || "").trim();
  if (!t || t.toLowerCase() === "transparent") return "transparent";
  const a = clampAlpha(tintAlpha);
  if (a <= 0) return "transparent";

  const rgbaMatch = t.match(/^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/i);
  if (rgbaMatch) {
    const baseA = parseFloat(rgbaMatch[4]);
    if (a >= 1 && baseA < 1) return t;
    const nextA = baseA < 1 ? baseA * a : a;
    if (nextA <= 0.001) return "transparent";
    return nextA >= 1
      ? `rgb(${rgbaMatch[1]}, ${rgbaMatch[2]}, ${rgbaMatch[3]})`
      : `rgba(${rgbaMatch[1]}, ${rgbaMatch[2]}, ${rgbaMatch[3]}, ${nextA})`;
  }

  return applySolidTableTintToCssColor(t, a);
}
