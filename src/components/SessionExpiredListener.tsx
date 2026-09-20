"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
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

  /** ✅ 안전장치: 관리자 외 페이지에서 body/html overflow 강제 초기화
   *  - 관리자 페이지에서 set한 overflow:hidden stale 상태가 페이지 이동 후에도 남아
   *    스크롤이 영구적으로 막히는 버그 방지
   *  - /admin 경로에서는 관리자 컴포넌트 자체 lock 로직이 작동하므로 관여하지 않음 */
  useLayoutEffect(() => {
    if (pathname?.startsWith("/admin")) return;
    document.body.style.overflow = "";
    document.documentElement.style.overflow = "";
  }, [pathname]);

  return null;
}
