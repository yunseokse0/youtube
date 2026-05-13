import { redirect } from "next/navigation";

/** 짧은 주소: 회전판은 `/overlay/sig-sales` 사용 */
export default function WheelShortcutPage() {
  redirect("/overlay/sig-sales");
}
