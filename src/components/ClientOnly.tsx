"use client";

import { useEffect, useState, type ReactNode } from "react";

/** SSR·첫 hydration에 children 미포함 → 서버/클라 HTML 불일치 방지 */
export default function ClientOnly({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <>{fallback}</>;
  return <>{children}</>;
}
