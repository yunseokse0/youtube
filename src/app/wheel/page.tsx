import { redirect } from "next/navigation";
import { getSigSalesWheelDemoPath } from "@/lib/sig-sales-wheel-demo";

/** 짧은 주소: http://localhost:3000/wheel */
export default function WheelShortcutPage() {
  redirect(getSigSalesWheelDemoPath());
}
