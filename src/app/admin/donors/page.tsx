export const dynamic = "force-dynamic";

import { Suspense } from "react";
import AdminDonorListPopupPanel from "@/components/admin/popup/AdminDonorListPopupPanel";

export default function AdminDonorsPopupPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-neutral-950 text-neutral-400">
          로딩…
        </div>
      }
    >
      <AdminDonorListPopupPanel />
    </Suspense>
  );
}
