"use client";

import { Suspense } from "react";
import SigMatchDemoClient from "./SigMatchDemoClient";

export default function SigMatchDemoPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-[100dvh] bg-neutral-950 p-4 text-center text-sm text-neutral-400">
          시그 대전 데모 로딩…
        </main>
      }
    >
      <SigMatchDemoClient />
    </Suspense>
  );
}
