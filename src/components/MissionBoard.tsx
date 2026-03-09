"use client";

import React from "react";
import { MissionItem } from "@/lib/state";

type MissionThemeVariant = "default" | "excel" | "neon" | "retro" | "minimal" | "rpg" | "pastel" | "neonExcel";

const MISSION_THEME_STYLES: Record<MissionThemeVariant, { itemColor: string; itemShadow: string; titleColor: string; bgColor: string }> = {
  default: { itemColor: "#fde68a", itemShadow: "0 0 6px rgba(253, 230, 138, 0.65)", titleColor: "#fcd34d", bgColor: "rgba(6, 8, 16, 0.85)" },
  excel: { itemColor: "#1e3a2e", itemShadow: "none", titleColor: "#217346", bgColor: "rgba(255, 255, 255, 0.95)" },
  neon: { itemColor: "#ffcc4d", itemShadow: "0 0 8px rgba(255, 204, 77, 0.8)", titleColor: "#7df9ff", bgColor: "rgba(4, 8, 18, 0.9)" },
  retro: { itemColor: "#bbf7d0", itemShadow: "none", titleColor: "#86efac", bgColor: "rgba(8, 12, 8, 0.92)" },
  minimal: { itemColor: "#f3f4f6", itemShadow: "none", titleColor: "#e5e7eb", bgColor: "rgba(15, 15, 18, 0.75)" },
  rpg: { itemColor: "#fde68a", itemShadow: "0 0 5px rgba(250, 204, 21, 0.55)", titleColor: "#facc15", bgColor: "rgba(27, 20, 8, 0.9)" },
  pastel: { itemColor: "#fdf2f8", itemShadow: "0 0 6px rgba(233, 213, 255, 0.45)", titleColor: "#fbcfe8", bgColor: "rgba(95, 66, 132, 0.7)" },
  neonExcel: { itemColor: "#a5f3fc", itemShadow: "0 0 6px rgba(103, 232, 249, 0.5)", titleColor: "#67e8f9", bgColor: "rgba(4, 13, 20, 0.9)" },
};

type MissionBoardProps = {
  missions: MissionItem[];
  fontSize?: number;
  themeVariant?: MissionThemeVariant;
  duration?: number;
  bgOpacity?: number;
  bgColor?: string;
  itemColor?: string;
  titleColor?: string;
  effect?: "none" | "blink" | "pulse" | "glow";
  effectHotOnly?: boolean;
};

const MissionBoard = ({
  missions,
  fontSize = 18,
  themeVariant = "default",
  duration = 25,
  bgOpacity,
  bgColor,
  itemColor,
  titleColor,
  effect = "none",
  effectHotOnly = false,
}: MissionBoardProps) => {
  if (!missions.length) return null;
  const base = MISSION_THEME_STYLES[themeVariant] || MISSION_THEME_STYLES.default;
  const theme = {
    ...base,
    itemColor: itemColor || base.itemColor,
    titleColor: titleColor || base.titleColor,
    bgColor: (() => {
      const toRgba = (hex: string, op: number) => {
        const h = hex.replace("#", "");
        if (h.length === 3) {
          const r = parseInt(h[0] + h[0], 16);
          const g = parseInt(h[1] + h[1], 16);
          const b = parseInt(h[2] + h[2], 16);
          return `rgba(${r}, ${g}, ${b}, ${op})`;
        }
        if (h.length === 6) {
          const r = parseInt(h.slice(0, 2), 16);
          const g = parseInt(h.slice(2, 4), 16);
          const b = parseInt(h.slice(4, 6), 16);
          return `rgba(${r}, ${g}, ${b}, ${op})`;
        }
        return hex;
      };
      const o = typeof bgOpacity === "number" ? Math.max(0, Math.min(1, bgOpacity / 100)) : undefined;
      if (bgColor && o !== undefined) return toRgba(bgColor, o);
      if (o === undefined) return bgColor || base.bgColor;
      const m = (bgColor || base.bgColor).match(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([0-9.]+)\s*\)/i);
      if (m) {
        const [, r, g, b] = m;
        return `rgba(${r}, ${g}, ${b}, ${o})`;
      }
      return bgColor || base.bgColor;
    })(),
  };

  const content = (
    <>
      <style>{`
        @keyframes fx-blink { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0.4 } }
        @keyframes fx-pulse { 0% { transform: scale(1) } 50% { transform: scale(1.06) } 100% { transform: scale(1) } }
        @keyframes fx-glow { 0% { text-shadow: 0 0 0 rgba(255,255,255,0.0) } 50% { text-shadow: 0 0 10px rgba(255,255,255,0.6) } 100% { text-shadow: 0 0 0 rgba(255,255,255,0.0) } }
        .fx-blink { animation: fx-blink 1.2s steps(2, end) infinite }
        .fx-pulse { animation: fx-pulse 1.8s ease-in-out infinite }
        .fx-glow { animation: fx-glow 1.6s ease-in-out infinite }
      `}</style>
      <span className="font-black tracking-widest" style={{ color: theme.titleColor, marginRight: 32 }}>
        ■ MISSION ■
      </span>
      {missions.map((item, idx) => (
        <span
          key={item.id}
          className={
            effect === "none" ? "" :
            effectHotOnly ? (item.isHot ? (effect === "blink" ? "fx-blink" : effect === "pulse" ? "fx-pulse" : "fx-glow") : "") :
            (effect === "blink" ? "fx-blink" : effect === "pulse" ? "fx-pulse" : "fx-glow")
          }
          style={{ marginLeft: 24, marginRight: 24, color: theme.itemColor, textShadow: theme.itemShadow, fontWeight: 700 }}
        >
          {item.isHot && <span className="text-red-400">[HOT] </span>}
          {item.title}
          <span style={{ marginLeft: 8, color: theme.titleColor, fontWeight: 800 }}>- {item.price}</span>
          {idx < missions.length - 1 && <span style={{ marginLeft: 16, opacity: 0.6 }}>•</span>}
        </span>
      ))}
    </>
  );

  return (
    <div
      className="overflow-hidden rounded py-2 px-3 w-full"
      style={{
        fontSize,
        background: theme.bgColor,
      }}
    >
      <div className="overflow-hidden whitespace-nowrap">
        <div
          className="inline-block"
          style={{ animation: `mission-ticker-flow ${duration}s linear infinite` }}
        >
          {content}
          <span style={{ marginLeft: 48 }} />
          {content}
          <span style={{ marginLeft: 48 }} />
          {content}
        </div>
      </div>
    </div>
  );
};

export default MissionBoard;
