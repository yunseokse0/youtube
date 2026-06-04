"use client";

import { useEffect, useState } from "react";
import SigSalesOverlayPage from "../sig-sales/page";

/** OBS CEF: 주소창 쿼리에 mode=manual 이 없어도 수동 모드가 되도록 동기화 */
function ensureManualOverlayQueryInAddressBar(): void {
  if (typeof window === "undefined") return;
  const q = new URLSearchParams(window.location.search);
  let changed = false;
  if (String(q.get("mode") || "").toLowerCase() !== "manual") {
    q.set("mode", "manual");
    changed = true;
  }
  if (!q.has("hideSigBoard")) {
    q.set("hideSigBoard", "1");
    changed = true;
  }
  if (!changed) return;
  const next = `${window.location.pathname}?${q.toString()}`;
  window.history.replaceState({}, "", next);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** 수동 판매 OBS 전용 라우트 — 회전판 오버레이와 URL·렌더 분리 */
export default function SigSalesManualOverlayPage() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    ensureManualOverlayQueryInAddressBar();
    setReady(true);
  }, []);
  if (!ready) {
    return <main className="fixed inset-0 bg-transparent" aria-busy="true" />;
  }
  return <SigSalesOverlayPage />;
}
