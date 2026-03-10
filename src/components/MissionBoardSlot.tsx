'use client';

import React, { useEffect, useMemo, useState } from "react";
import { MissionItem } from "@/lib/state";
import { motion, AnimatePresence } from "framer-motion";

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

type MissionBoardSlotProps = {
  missions: MissionItem[];
  fontSize?: number;
  themeVariant?: MissionThemeVariant;
  titleText?: string;
  visibleCount?: number;
  speed?: number; // seconds per step
  gapSize?: number; // px
  bgOpacity?: number;
  bgColor?: string;
  itemColor?: string;
  titleColor?: string;
  effect?: "none" | "blink" | "pulse" | "glow" | "sparkle";
  effectHotOnly?: boolean;
};

export default function MissionBoardSlot({
  missions,
  fontSize = 18,
  themeVariant = "default",
  titleText = "MISSION",
  visibleCount = 3,
  speed = 2,
  gapSize = 8,
  bgOpacity,
  bgColor,
  itemColor,
  titleColor,
  effect = "none",
  effectHotOnly = false,
}: MissionBoardSlotProps) {
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

  const [start, setStart] = useState(0);
  const items = useMemo(() => {
    if (!missions || missions.length === 0) return [];
    const list = [...missions, ...missions]; // wrap-around
    return list.slice(start, start + Math.max(1, visibleCount));
  }, [missions, start, visibleCount]);

  useEffect(() => {
    if (!missions || missions.length === 0) return;
    const interval = setInterval(() => {
      setStart((s) => (missions.length > 0 ? (s + 1) % missions.length : 0));
    }, Math.max(300, speed * 1000));
    return () => clearInterval(interval);
  }, [missions.length, speed]);

  return (
    <div
      className="overflow-hidden rounded py-2 px-3 w-full"
      style={{
        fontSize,
        background: theme.bgColor,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", marginBottom: gapSize }}>
        <span className="font-black tracking-widest" style={{ color: theme.titleColor }}>
          ■ {titleText || "MISSION"} ■
        </span>
      </div>
      <div style={{ display: "grid", gap: gapSize }}>
        <AnimatePresence initial={false} mode="popLayout">
          {items.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.7 }}
              transition={{ duration: 0.3 }}
              style={{ color: theme.titleColor, fontWeight: 700 }}
            >
              미션이 없습니다
            </motion.div>
          ) : (
            items.map((item) => {
              const applyEffect = !effectHotOnly || Boolean(item.isHot);
              const getEffectAnim = () => {
                if (!applyEffect) return {};
                switch (effect) {
                  case "blink":
                    return {
                      animate: { opacity: [1, 0.5, 1] },
                      transition: { repeat: Infinity, duration: 1.2, ease: "easeInOut" },
                    };
                  case "pulse":
                    return {
                      animate: { scale: [1, 1.03, 1] },
                      transition: { repeat: Infinity, duration: 1.8, ease: "easeInOut" },
                    };
                  case "glow":
                    return {
                      animate: { filter: ["drop-shadow(0 0 0px rgba(255,255,200,0.0))", "drop-shadow(0 0 6px rgba(255,255,200,0.7))", "drop-shadow(0 0 0px rgba(255,255,200,0.0))"] },
                      transition: { repeat: Infinity, duration: 2.2, ease: "easeInOut" },
                    };
                  case "sparkle":
                    return {
                      animate: { filter: ["brightness(1)", "brightness(1.25)", "brightness(1)"] },
                      transition: { repeat: Infinity, duration: 1.6, ease: "easeInOut" },
                    };
                  default:
                    return {};
                }
              };
              const anim = getEffectAnim();
              return (
            <motion.div
              layout
                key={`${start}_${item.id}`}
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                transition={{ duration: 0.35 }}
                style={{
                  color: theme.itemColor,
                  textShadow: theme.itemShadow,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                }}
              >
                {item.isHot && <span className="text-red-400" style={{ marginRight: 6 }}>[HOT]</span>}
                <motion.span style={{ flex: 1 }} {...anim}>
                  {item.title}
                </motion.span>
                <motion.span style={{ marginLeft: 12, color: theme.titleColor, fontWeight: 800 }} {...anim}>
                  {item.price}
                </motion.span>
              </motion.div>
              );
            })
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
