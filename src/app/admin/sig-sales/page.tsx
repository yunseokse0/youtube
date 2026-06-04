"use client";

export const dynamic = "force-dynamic";

import { AdminSigSalesPage } from "@/app/admin/sig-sales/AdminSigSalesPage";

export default function AdminSigSalesWheelPage() {
  return <AdminSigSalesPage manualOnly={false} />;
}
