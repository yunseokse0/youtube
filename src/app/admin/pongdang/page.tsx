export const dynamic = "force-dynamic";

import { Suspense } from "react";
import AdminPongdangPopupPanel from "@/components/admin/popup/AdminPongdangPopupPanel";

export default function AdminPongdangPopupPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-neutral-950 text-neutral-400">
          로딩…
        </div>
      }
    >
      <AdminPongdangPopupPanel />
    </Suspense>
  );
}
