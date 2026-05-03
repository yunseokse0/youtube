import type { Metadata, Viewport } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "오버레이",
  robots: "noindex, nofollow",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function OverlayLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="overlay-route" style={{ position: "fixed", inset: 0, minHeight: "100vh", minWidth: "100vw", overflow: "hidden" }}>
      <style dangerouslySetInnerHTML={{ __html: `
        html.overlay-page, body.overlay-page { background: transparent !important; }
        .overlay-route { background: transparent !important; -webkit-font-smoothing: antialiased; -webkit-backface-visibility: hidden; backface-visibility: hidden; }
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
        /* 파스텔 테마: 구분선 없이 행 배경만 교차 */
        table.pastel-member-table tbody tr.overlay-row:nth-child(odd) td { background-color: rgba(199, 206, 234, 0.32) !important; }
        table.pastel-member-table tbody tr.overlay-row:nth-child(even) td { background-color: rgba(226, 240, 203, 0.36) !important; }
      ` }} />
      {children}
    </div>
  );
}
