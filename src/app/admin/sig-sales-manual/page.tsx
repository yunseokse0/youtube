"use client";

export const dynamic = "force-dynamic";

import { AdminSigSalesPage } from "@/app/admin/sig-sales/AdminSigSalesPage";

/** 수동 시그 판매(5개+한방) — 회전판과 분리 · 오버레이 관리에서 링크 */
export default function AdminSigSalesManualRoutePage() {
  return <AdminSigSalesPage manualOnly />;
}
