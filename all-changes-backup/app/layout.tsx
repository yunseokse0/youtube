import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "엑셀방송 정산 시스템",
  description: "엑셀방송 전용 후원 관리자 및 오버레이",
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

