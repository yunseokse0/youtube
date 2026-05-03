import { redirect } from "next/navigation";
import { getSigSalesResultPreviewPath } from "@/lib/sig-sales-wheel-demo";

/** 짧은 주소: `npm run dev` 후 `/overlay/sig-sales/demo-result` */
export default function SigSalesDemoResultRedirectPage() {
  redirect(getSigSalesResultPreviewPath());
}
