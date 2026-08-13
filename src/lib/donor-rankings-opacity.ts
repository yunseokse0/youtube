/**
 * 후원순위 오버레이 배경 투명도.
 * - 슬라이더 선형 알파를 그대로 쓰면 OBS 검정 캔버스 위에서 급격히 어두워 보임
 * - soft 곡선 + 어두운 RGB 리프트로 중간 구간을 밝게 유지
 */

export function softOverlayOpacityFrac(frac: number): number {
  const f = Math.max(0, Math.min(1, frac));
  if (f <= 0) return 0;
  if (f >= 1) return 1;
  // 50% → ~0.66, 25% → ~0.42 (선형보다 덜 꺼짐)
  return Math.pow(f, 0.6);
}

type Rgba = { r: number; g: number; b: number; a: number };

function parseCssColor(bg: string): Rgba | null {
  const t = (bg || "").trim();
  if (!t || t.toLowerCase() === "transparent") return null;

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{8}|[0-9a-f]{6})$/i.exec(t);
  if (hex) {
    const h = hex[1];
    const expand = (s: string) => (s.length === 3 ? s.split("").map((c) => c + c).join("") : s);
    const full = expand(h);
    if (full.length === 8) {
      return {
        r: parseInt(full.slice(0, 2), 16),
        g: parseInt(full.slice(2, 4), 16),
        b: parseInt(full.slice(4, 6), 16),
        a: parseInt(full.slice(6, 8), 16) / 255,
      };
    }
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
      a: 1,
    };
  }

  const rgb = /^rgb\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\)$/i.exec(t);
  if (rgb) {
    return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a: 1 };
  }

  const rgbaM = /^rgba\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\)$/i.exec(t);
  if (rgbaM) {
    return {
      r: Number(rgbaM[1]),
      g: Number(rgbaM[2]),
      b: Number(rgbaM[3]),
      a: Number(rgbaM[4]),
    };
  }

  return null;
}

/** 검정 위 반투명에서 진해 보이지 않게, 투명해질수록 RGB를 흰색 쪽으로 살짝 올림 */
export function liftRgbForFade(r: number, g: number, b: number, softFrac: number): { r: number; g: number; b: number } {
  const lift = (1 - softFrac) * 0.42;
  if (lift <= 0) return { r, g, b };
  return {
    r: Math.round(r + (255 - r) * lift),
    g: Math.round(g + (255 - g) * lift),
    b: Math.round(b + (255 - b) * lift),
  };
}

/**
 * 슬라이더 불투명도를 배경에 반영.
 * hex/rgb/rgba는 알파를 색에 직접 넣고, gradient 등은 레이어 opacity 유지.
 */
export function backgroundWithOpacityFrac(
  bg: string,
  frac: number
): { background: string; opacity?: number } {
  const soft = softOverlayOpacityFrac(frac);
  if (soft <= 0) return { background: "transparent" };
  const t = (bg || "").trim();
  if (!t || t.toLowerCase() === "transparent") return { background: "transparent" };

  if (/^linear-gradient\s*\(/i.test(t) || /^radial-gradient\s*\(/i.test(t) || /^url\s*\(/i.test(t)) {
    return { background: t, opacity: soft };
  }

  const parsed = parseCssColor(t);
  if (parsed) {
    const lifted = liftRgbForFade(parsed.r, parsed.g, parsed.b, soft);
    const a = Math.max(0, Math.min(1, parsed.a * soft));
    return { background: `rgba(${lifted.r},${lifted.g},${lifted.b},${a})` };
  }

  return { background: t, opacity: soft };
}

/** 행 배경용 — 항상 문자열 하나로 (텍스트 opacity에 영향 없음) */
export function solidBackgroundWithOpacityFrac(bg: string | undefined, frac: number): string {
  const raw = (bg || "").trim() || "transparent";
  return backgroundWithOpacityFrac(raw, frac).background;
}
