"use client";

import { motion } from "framer-motion";
import type { MealGaugeAnimStyle } from "@/lib/meal-gauge-motion";

type MealGaugeFillMotionProps = {
  style: MealGaugeAnimStyle;
};

/** 채움 막대 안 오버레이 — 부모에 `overflow-hidden` 필요 */
export function MealGaugeFillMotion({ style }: MealGaugeFillMotionProps) {
  if (style === "none") return null;

  const overlay = "pointer-events-none absolute inset-0 overflow-hidden";

  switch (style) {
    case "flow":
      return (
        <motion.div
          className={overlay}
          style={{
            background:
              "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.15) 35%, rgba(255,255,255,0.42) 50%, rgba(255,255,255,0.15) 65%, transparent 100%)",
            backgroundSize: "200% 100%",
          }}
          animate={{ backgroundPositionX: ["0%", "100%"] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: "linear" }}
          aria-hidden
        />
      );
    case "stream":
      return (
        <motion.div
          className={`${overlay} bg-gradient-to-r from-transparent via-white/45 to-transparent`}
          style={{ width: "35%" }}
          initial={{ x: "-40%" }}
          animate={{ x: ["-40%", "320%"] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }}
          aria-hidden
        />
      );
    case "shimmer":
      return (
        <motion.div
          className={overlay}
          style={{
            background:
              "linear-gradient(105deg, transparent 35%, rgba(255,255,255,0.5) 50%, transparent 65%)",
            backgroundSize: "250% 100%",
          }}
          animate={{ backgroundPositionX: ["-80%", "180%"] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
          aria-hidden
        />
      );
    case "breathe":
      return (
        <motion.div
          className={`${overlay} bg-white/25`}
          animate={{ opacity: [0.12, 0.38, 0.12] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          aria-hidden
        />
      );
    case "wave":
      return (
        <motion.div
          className={overlay}
          style={{
            background:
              "repeating-linear-gradient(180deg, rgba(255,255,255,0.08) 0px, rgba(255,255,255,0.22) 8px, rgba(255,255,255,0.08) 16px)",
            backgroundSize: "100% 32px",
          }}
          animate={{ backgroundPositionY: ["0px", "32px"] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }}
          aria-hidden
        />
      );
    case "stripe":
      return (
        <motion.div
          className={overlay}
          style={{
            background:
              "repeating-linear-gradient(90deg, transparent, transparent 28%, rgba(255,255,255,0.2) 28%, rgba(255,255,255,0.2) 42%, transparent 42%, transparent 70%)",
            backgroundSize: "64px 100%",
          }}
          animate={{ backgroundPositionX: ["0px", "64px"] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
          aria-hidden
        />
      );
    case "default":
    default:
      return (
        <motion.div
          className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white/55 to-transparent sm:w-10"
          animate={{ opacity: [0.25, 0.75, 0.25] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
          aria-hidden
        />
      );
  }
}
