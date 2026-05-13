/** 로컬에서 결과 카드 줄만 바로 볼 때 */
export function getSigSalesResultPreviewPath(query?: Record<string, string>): string {
  const base = "/overlay/sig-sales/result-preview";
  if (!query || Object.keys(query).length === 0) return base;
  return `${base}?${new URLSearchParams(query).toString()}`;
}
