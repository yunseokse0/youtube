import { redirect } from "next/navigation";
import { getWheelDemoOverlayPath } from "@/lib/sig-wheel-demo-pool";

/** 짧은 주소: 로컬 휠 데모 20칸 + 5당첨·한방 자동 스핀 */
export default function WheelShortcutPage() {
  redirect(getWheelDemoOverlayPath());
}
