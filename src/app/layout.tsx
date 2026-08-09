import "./globals.css";
import type { Metadata } from "next";
import SessionExpiredListener from "@/components/SessionExpiredListener";
import { APP_SYSTEM_DESCRIPTION, APP_SYSTEM_NAME } from "@/lib/app-branding";

export const metadata: Metadata = {
  title: APP_SYSTEM_NAME,
  description: APP_SYSTEM_DESCRIPTION,
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

