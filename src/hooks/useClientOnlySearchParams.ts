"use client";

import { useEffect, useState } from "react";

/**
 * SSR·클라이언트 첫 페인트를 동일하게 맞춘다.
 * `useState(() => new URLSearchParams(window.location.search))` 는 React #418(하이드레이션 불일치) 유발.
 * OBS CEF: `useSearchParams`+Suspense 대신 마운트 후 location.search 동기화.
 */
export function useClientOnlySearchParams(): {
  params: URLSearchParams;
  ready: boolean;
} {
  const [ready, setReady] = useState(false);
  const [params, setParams] = useState(() => new URLSearchParams());

  useEffect(() => {
    const sync = () => setParams(new URLSearchParams(window.location.search));
    sync();
    setReady(true);
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  return { params, ready };
}
