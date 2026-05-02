import "./globals.css";
import type { Metadata } from "next";
import SessionExpiredListener from "@/components/SessionExpiredListener";

export const metadata: Metadata = {
  title: "Final Entertainment 방송 정산 시스템",
  description: "Final Entertainment 방송 정산 관리자 및 오버레이",
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
    apple: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" className="dark">
      <body>
        <SessionExpiredListener />
        {children}
      </body>
    </html>
  );
}

