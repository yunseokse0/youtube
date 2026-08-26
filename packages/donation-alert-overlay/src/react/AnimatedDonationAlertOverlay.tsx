"use client";

import { AnimatePresence, motion } from "framer-motion";
import { DonationAlertCard, type DonationAlertCardProps } from "./DonationAlertCard";
import type { DonationAlertShowItem } from "../types";

export type AnimatedDonationAlertOverlayProps = {
  current: DonationAlertShowItem | null;
  className?: string;
  cardProps?: Omit<DonationAlertCardProps, "alert">;
};

/** framer-motion 애니메이션 버전 (본 프로젝트 OBS용) */
export function AnimatedDonationAlertOverlay({
  current,
  className = "",
  cardProps,
}: AnimatedDonationAlertOverlayProps) {
  return (
    <main
      className={`min-h-[100dvh] w-full bg-transparent p-3 text-white ${className}`}
      data-overlay="donation-alert"
    >
      <div className="flex min-h-[min(100dvh,28rem)] w-full items-center justify-center">
        <AnimatePresence mode="wait">
          {current ? (
            <motion.div
              key={current.id}
              initial={{ opacity: 0, y: 18, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.96 }}
              transition={{ duration: 0.28, ease: "easeOut" }}
            >
              <DonationAlertCard alert={current} {...cardProps} />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </main>
  );
}
