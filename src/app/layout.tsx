import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Final Entertainment 방송 정산 시스템",
  description: "Final Entertainment 방송 정산 관리자 및 오버레이",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" className="dark">
      <body>{children}</body>
    </html>
  );
}

