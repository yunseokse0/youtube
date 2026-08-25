import "./globals.css";
import type { Metadata } from "next";
import SessionExpiredListener from "@/components/SessionExpiredListener";
import { APP_SYSTEM_DESCRIPTION, APP_SYSTEM_NAME } from "@/lib/app-branding";

export const metadata: Metadata = {
  title: APP_SYSTEM_NAME,
  description: APP_SYSTEM_DESCRIPTION,
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/apple-icon.png", type: "image/png", sizes: "180x180" }],
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

