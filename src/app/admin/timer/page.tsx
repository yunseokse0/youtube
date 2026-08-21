export const dynamic = "force-dynamic";

import { Suspense } from "react";
import AdminTimerPopupPanel from "@/components/admin/popup/AdminTimerPopupPanel";

export default function AdminTimerPopupPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-neutral-950 text-neutral-400">
          로딩…
        </div>
      }
    >
      <AdminTimerPopupPanel />
    </Suspense>
  );
}
