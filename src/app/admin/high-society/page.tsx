export const dynamic = "force-dynamic";

import { Suspense } from "react";
import AdminHighSocietyPopupPanel from "@/components/admin/popup/AdminHighSocietyPopupPanel";

export default function AdminHighSocietyPopupPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-neutral-950 text-neutral-400">
          로딩…
        </div>
      }
    >
      <AdminHighSocietyPopupPanel />
    </Suspense>
  );
}
