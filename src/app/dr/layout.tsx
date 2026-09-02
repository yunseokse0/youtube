import type { Metadata, Viewport } from "next";
import OverlayLayoutShell from "@/components/overlay/OverlayLayoutShell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "후원순위",
  robots: "noindex, nofollow",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function DonorRankingsShortLayout({ children }: { children: React.ReactNode }) {
  return <OverlayLayoutShell>{children}</OverlayLayoutShell>;
}
