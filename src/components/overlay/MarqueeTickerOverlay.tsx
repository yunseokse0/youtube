"use client";

import React, { useMemo } from "react";
import type { TickerSettings } from "@/types";

type Props = {
  settings?: TickerSettings | null;
  className?: string;
};

export function MarqueeTickerOverlay({ settings, className = "" }: Props) {
  if (!settings || !settings.enabled) return null;

  const badgeText = settings.badgeText || "NOTICE";
  const badgeBgColor = settings.badgeBgColor || "#dc2626"; // red-600
  const badgeTextColor = settings.badgeTextColor || "#ffffff";
  const rawText = settings.text || "";
  const speedSec = Math.max(5, settings.speedSec || 35);
  const fontSizePx = Math.max(11, settings.fontSizePx || 14);
  const textColor = settings.textColor || "#ffffff";
  const bgColor = settings.bgColor || "rgba(10, 10, 10, 0.85)";

  if (!rawText.trim()) return null;

  // Seamless marquee: duplicate content twice to create infinite loop
  const formattedContent = useMemo(() => {
    // If text already has separators, preserve them; otherwise add nice separators
    const content = rawText.trim();
    return `${content} \u00A0\u00A0\u00A0✦\u00A0\u00A0\u00A0 `;
  }, [rawText]);

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-50 flex items-center h-11 border-t border-white/10 select-none overflow-hidden ${className}`}
      style={{ backgroundColor: bgColor }}
    >
      {/* 1. 좌측 고정 배지 (NOTICE / 공지 등) */}
      <div className="flex-shrink-0 z-10 pl-3 pr-2 flex items-center">
        <div
          className="rounded-full px-3 py-0.5 text-xs font-black tracking-widest uppercase shadow-md flex items-center gap-1.5"
          style={{ backgroundColor: badgeBgColor, color: badgeTextColor }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
          <span>{badgeText}</span>
        </div>
      </div>

      {/* 2. 우측 횡스크롤 티커 영역 */}
      <div className="relative flex-1 overflow-hidden h-full flex items-center">
        <div
          className="ticker-track flex whitespace-nowrap will-change-transform"
          style={{
            animation: `marquee-scroll ${speedSec}s linear infinite`,
          }}
        >
          <span
            className="inline-block font-bold tracking-wide text-shadow-sm"
            style={{
              fontSize: `${fontSizePx}px`,
              color: textColor,
              textShadow: "0 1px 3px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,0.8)",
            }}
          >
            {formattedContent}
          </span>
          <span
            className="inline-block font-bold tracking-wide text-shadow-sm"
            style={{
              fontSize: `${fontSizePx}px`,
              color: textColor,
              textShadow: "0 1px 3px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,0.8)",
            }}
          >
            {formattedContent}
          </span>
          <span
            className="inline-block font-bold tracking-wide text-shadow-sm"
            style={{
              fontSize: `${fontSizePx}px`,
              color: textColor,
              textShadow: "0 1px 3px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,0.8)",
            }}
          >
            {formattedContent}
          </span>
        </div>
      </div>

      <style jsx>{`
        @keyframes marquee-scroll {
          0% {
            transform: translateX(0%);
          }
          100% {
            transform: translateX(-33.3333%);
          }
        }
      `}</style>
    </div>
  );
}
