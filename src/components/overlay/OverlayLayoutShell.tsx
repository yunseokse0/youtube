"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import OverlayBroadcastHygiene from "@/components/overlay/OverlayBroadcastHygiene";
import {
  isOverlayToolsHubPath,
  shouldUseOverlayScrollableShell,
} from "@/lib/overlay-shell-layout";

const overlayRouteCss = `
  html, body, #__next { background: transparent !important; background-color: transparent !important; }
  .overlay-route { background: transparent !important; background-color: transparent !important; -webkit-font-smoothing: antialiased; -webkit-backface-visibility: hidden; backface-visibility: hidden; }
  @media (max-width: 767px) {
    html, body, #__next { background: transparent !important; background-color: transparent !important; }
    body { background-image: none !important; }
  }
  .overlay-root { font-size: 100%; -webkit-font-smoothing: antialiased; }
  .overlay-row td { padding: 0.18em 0.25em !important; min-height: 1.5em; line-height: 1.2; vertical-align: middle; text-shadow: 0 1px 2px rgba(0,0,0,0.8); }
  .overlay-row { min-height: 1.5em; }
  .overlay-root table { -webkit-backface-visibility: hidden; backface-visibility: hidden; }
  .overlay-root table td { font-size: inherit !important; }
  .overlay-root table thead td { line-height: 1.2; padding: 0.18em 0.25em !important; }
  .overlay-root table:not(.overlay-elegant-table) .overlay-total-row td { font-size: 1.15em !important; padding: 0.3em 0.35em !important; line-height: 1.25; min-height: 1.8em; font-weight: 600; }
  .overlay-root table .overlay-rank-cell { white-space: nowrap !important; }
  .overlay-root table:not(.overlay-elegant-table) td { writing-mode: horizontal-tb; text-orientation: mixed; white-space: nowrap !important; overflow: hidden !important; container-type: inline-size; font-size: min(1em, 18cqw) !important; }
  .overlay-root table:not(.overlay-elegant-table) .overlay-total-row td { font-size: min(1.15em, 20cqw) !important; }
  .overlay-root table.overlay-elegant-table td { writing-mode: horizontal-tb; text-orientation: mixed; white-space: nowrap !important; overflow: visible !important; container-type: inline-size; font-size: inherit !important; }
  .overlay-root table.overlay-elegant-table .overlay-total-row td { font-size: 1.15em !important; padding: 0.3em 0.35em !important; line-height: 1.25; min-height: 1.8em; font-weight: 600; }
  table.pastel-member-table tbody tr.overlay-row:nth-child(odd) td { background-color: rgba(199, 206, 234, 0.32) !important; }
  table.pastel-member-table tbody tr.overlay-row:nth-child(even) td { background-color: rgba(226, 240, 203, 0.36) !important; }
  html.overlay-hub-preview .overlay-route {
    overflow-x: hidden !important;
    overflow-y: auto !important;
    align-items: flex-start;
  }
  html.overlay-hub-preview, html.overlay-hub-preview body, html.overlay-hub-preview #__next {
    height: auto !important;
    min-height: 100% !important;
  }
`;

export default function OverlayLayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  /** SSR·첫 hydration: pathname 기준(데모 URL과 동일) */
  const [scrollable, setScrollable] = useState(() => isOverlayToolsHubPath(pathname));

  useEffect(() => {
    setScrollable(shouldUseOverlayScrollableShell(pathname));
  }, [pathname]);

  if (scrollable) {
    return (
      <div className="min-h-[100dvh] w-full bg-neutral-950 text-white" suppressHydrationWarning>
        <OverlayBroadcastHygiene />
        {children}
      </div>
    );
  }

  return (
    <div
      className="overlay-route"
      suppressHydrationWarning
      style={{
        position: "fixed",
        inset: 0,
        minHeight: "100vh",
        minWidth: "100vw",
        overflow: "hidden",
        background: "transparent",
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: overlayRouteCss }} />
      <OverlayBroadcastHygiene />
      {children}
    </div>
  );
}
