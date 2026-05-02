"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

/** `/api/state` 401(세션 만료) 시 `lib/state`에서 `broadcast-session-expired`를 보내면 로그인으로 유도 */
export default function SessionExpiredListener() {
  const router = useRouter();
  const pathname = usePathname();
  const onceRef = useRef(false);

  useEffect(() => {
    const onExpire = () => {
      if (!pathname.startsWith("/admin") && !pathname.startsWith("/settlements")) return;
      if (onceRef.current) return;
      onceRef.current = true;
      const from = pathname || "/admin";
      router.replace(`/login?reason=expired&from=${encodeURIComponent(from)}`);
    };
    window.addEventListener("broadcast-session-expired", onExpire);
    return () => window.removeEventListener("broadcast-session-expired", onExpire);
  }, [router, pathname]);

  return null;
}
