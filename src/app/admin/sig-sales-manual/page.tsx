import { redirect } from "next/navigation";

export default function AdminSigSalesManualPage() {
  redirect("/admin/sig-sales?view=manual");
}
