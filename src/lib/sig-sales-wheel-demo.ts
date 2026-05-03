/** 로컬 회전판 데모 오버레이로 보낼 경로(? 일괄) */
export function getSigSalesWheelDemoPath(): string {
  const q = new URLSearchParams({
    u: "demo",
    rouletteDemo: "1",
    menuCount: "5",
    devSequentialTest: "1",
  });
  return `/overlay/sig-sales?${q.toString()}`;
}

/** 로컬에서 결과 카드 줄만 바로 볼 때 */
export function getSigSalesResultPreviewPath(query?: Record<string, string>): string {
  const base = "/overlay/sig-sales/result-preview";
  if (!query || Object.keys(query).length === 0) return base;
  return `${base}?${new URLSearchParams(query).toString()}`;
}
