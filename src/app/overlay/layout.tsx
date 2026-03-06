import type { Metadata, Viewport } from "next";

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
    <div className="overlay-route" style={{ position: "fixed", inset: 0, minHeight: "100vh", minWidth: "100vw" }}>
      <style dangerouslySetInnerHTML={{ __html: `
        html.overlay-page, body.overlay-page { background: transparent !important; }
        .overlay-route { background: transparent !important; -webkit-font-smoothing: antialiased; -webkit-backface-visibility: hidden; backface-visibility: hidden; }
        .overlay-root { font-size: clamp(18px, 2.8vh, 26px); -webkit-font-smoothing: antialiased; }
        .overlay-row td { padding: 0.5rem 0.4rem; min-height: 5rem; vertical-align: middle; text-shadow: 0 1px 2px rgba(0,0,0,0.8); }
        .overlay-row { min-height: 5rem; }
        .overlay-root table { -webkit-backface-visibility: hidden; backface-visibility: hidden; }
      ` }} />
      {children}
    </div>
  );
}
