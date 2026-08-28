/**
 * 후원순위 테마 색상 해석.
 * - 저장 테마(live): `transparent` 포함 저장값 그대로 사용
 * - 테스트/URL: 쿼리 → 저장 → 방송 기본 순
 */

export function resolveDonorRankingsThemeColor(
  themeLive: boolean,
  useTest: boolean,
  urlValue: string | null | undefined,
  saved: string | undefined,
  broadcastDefault: string
): string {
  const fromUrl = String(urlValue ?? "").trim();
  if (!themeLive || useTest) {
    if (fromUrl) return fromUrl;
    const s = String(saved ?? "").trim();
    if (s) return s;
    return broadcastDefault;
  }
  const s = String(saved ?? "").trim();
  if (s) return s;
  return broadcastDefault;
}

export function resolveDonorRankingsThemeNumber(
  themeLive: boolean,
  useTest: boolean,
  urlValue: string | null | undefined,
  saved: number | undefined,
  min: number,
  max: number,
  fallback: number
): number {
  if (!themeLive || useTest) {
    const raw = String(urlValue ?? "").trim();
    if (raw) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) return Math.max(min, Math.min(max, parsed));
    }
    const n = Number(saved);
    if (Number.isFinite(n)) return Math.max(min, Math.min(max, n));
    return Math.max(min, Math.min(max, fallback));
  }
  const n = Number(saved);
  if (!Number.isFinite(n)) return Math.max(min, Math.min(max, fallback));
  return Math.max(min, Math.min(max, n));
}
