import { redirect } from "next/navigation";
import { getWheelDemoOverlayPath } from "@/lib/sig-wheel-demo-pool";

/** `/overlay/sig-sales/demo` → 경량 휠 데모 페이지 */
export default function SigSalesWheelDemoPage() {
  redirect(getWheelDemoOverlayPath());
}
