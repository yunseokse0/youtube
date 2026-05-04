/** 로컬 회전판 데모 오버레이로 보낼 경로(? 일괄) */
export function getSigSalesWheelDemoPath(): string {
  const q = new URLSearchParams({
    u: "demo",
    rouletteDemo: "1",
    menuCount: "5",
    devSequentialTest: "1",
    /** 라운드 간 다음 회전까지 대기(ms) — 순차 연출이 눈에 잘 들어오게 */
    sequentialNextSpinMs: "900",
    /** 휠 result 직후 카드 +1까지(ms) */
    sequentialCardEmergeMs: "400",
  });
  return `/overlay/sig-sales?${q.toString()}`;
}

/** 로컬에서 결과 카드 줄만 바로 볼 때 */
export function getSigSalesResultPreviewPath(query?: Record<string, string>): string {
  const base = "/overlay/sig-sales/result-preview";
  if (!query || Object.keys(query).length === 0) return base;
  return `${base}?${new URLSearchParams(query).toString()}`;
}
