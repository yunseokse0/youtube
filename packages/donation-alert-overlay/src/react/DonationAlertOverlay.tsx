"use client";

import type { ReactNode } from "react";
import { DonationAlertCard, type DonationAlertCardProps } from "./DonationAlertCard";
import type { DonationAlertShowItem } from "../types";

export type DonationAlertOverlayProps = {
  current: DonationAlertShowItem | null;
  className?: string;
  /** framer-motion 미설치 시 CSS만 사용 */
  animated?: boolean;
  cardProps?: Omit<DonationAlertCardProps, "alert">;
  /** animated=false 또는 motion 미사용 시 커스텀 래퍼 */
  renderWrapper?: (alert: DonationAlertShowItem, card: ReactNode) => ReactNode;
};

function StaticWrapper({ alert, card }: { alert: DonationAlertShowItem; card: ReactNode }) {
  return (
    <div
      key={alert.id}
      className="animate-[donationAlertIn_0.28s_ease-out]"
      style={{ animationFillMode: "both" }}
    >
      {card}
    </div>
  );
}

/** framer-motion은 peer optional — 있으면 동적 import 대신 호출측에서 AnimatedDonationAlertOverlay 사용 */
export function DonationAlertOverlay({
  current,
  className = "",
  animated = true,
  cardProps,
  renderWrapper,
}: DonationAlertOverlayProps) {
  const card = current ? <DonationAlertCard alert={current} {...cardProps} /> : null;

  return (
    <main
      className={`min-h-[100dvh] w-full bg-transparent p-3 text-white ${className}`}
      data-overlay="donation-alert"
    >
      <style>{`
        @keyframes donationAlertIn {
          from { opacity: 0; transform: translateY(18px) scale(0.94); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
      <div className="flex min-h-[min(100dvh,28rem)] w-full items-center justify-center">
        {current && card ? (
          renderWrapper ? (
            renderWrapper(current, card)
          ) : animated ? (
            <StaticWrapper alert={current} card={card} />
          ) : (
            card
          )
        ) : null}
      </div>
    </main>
  );
}
