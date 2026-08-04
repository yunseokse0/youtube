/**
 * 시그 롤링 한 장 표시 시간(ms).
 * 관리자에서 설정한 staticHoldMs 를 그대로 사용한다.
 * (예전 GIF 1루프 파싱은 짧은 delay·비동기 대기로 깜빡임/무시처럼 보였음)
 */
export function resolveSigRollingHoldMs(staticHoldMs: number): number {
  const n = Math.floor(Number(staticHoldMs));
  if (!Number.isFinite(n)) return 5000;
  return Math.max(1000, Math.min(120_000, n));
}

/** @deprecated resolveSigRollingHoldMs 사용. 호환용 동기 래퍼 */
export async function getSigRollingHoldMs(_pathOrUrl: string, staticHoldMs: number): Promise<number> {
  return resolveSigRollingHoldMs(staticHoldMs);
}

export function isProbablyGifPath(url: string): boolean {
  const p = url.split("?")[0].toLowerCase();
  return p.endsWith(".gif");
}
