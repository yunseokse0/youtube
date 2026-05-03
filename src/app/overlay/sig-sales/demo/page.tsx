import { redirect } from "next/navigation";

/** 로컬에서 바로 회전판 순차 연출 테스트 — `npm run dev` 후 이 경로만 열면 됨 */
export default function SigSalesWheelDemoPage() {
  const q = new URLSearchParams({
    u: "demo",
    rouletteDemo: "1",
    menuCount: "5",
    devSequentialTest: "1",
  });
  redirect(`/overlay/sig-sales?${q.toString()}`);
}
