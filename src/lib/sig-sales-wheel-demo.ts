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
