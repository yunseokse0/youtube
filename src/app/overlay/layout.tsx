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
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        .overlay-root { font-size: clamp(18px, 2.8vh, 26px); }
        .overlay-row td { padding: 0.5rem 0.4rem; min-height: 5rem; vertical-align: middle; }
        .overlay-row { min-height: 5rem; }
      ` }} />
      {children}
    </>
  );
}
