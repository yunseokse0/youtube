"use client";

import { donationAlertTargetLabel } from "../core";
import type { DonationAlertLabels, DonationAlertShowItem } from "../types";
import { DEFAULT_DONATION_ALERT_LABELS } from "../types";

export type DonationAlertCardProps = {
  alert: DonationAlertShowItem;
  className?: string;
  labels?: DonationAlertLabels;
  locale?: string;
};

/** OBS 후원 출력 — 후원자→멤버 / 금액 / 기여도 점수 */
export function DonationAlertCard({
  alert,
  className = "",
  labels = DEFAULT_DONATION_ALERT_LABELS,
  locale = "ko-KR",
}: DonationAlertCardProps) {
  const amountLabel = alert.amount.toLocaleString(locale);
  const targetLabel = donationAlertTargetLabel(alert.target, labels);
  const isAccount = alert.target === "account";

  return (
    <div
      className={`flex w-full max-w-[22rem] flex-col items-stretch gap-2.5 ${className}`}
      data-donation-alert="true"
      data-donation-target={alert.target}
    >
      <div className="flex items-center justify-center gap-2 rounded-full border border-white/35 bg-black/55 px-4 py-2 shadow-[0_4px_18px_rgba(0,0,0,0.45)] backdrop-blur-md">
        <span className="max-w-[45%] truncate text-base font-black tracking-tight text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)] sm:text-lg">
          {alert.donorName}
        </span>
        <span className="shrink-0 text-sm font-black text-amber-300" aria-hidden>
          ▶
        </span>
        <span className="max-w-[45%] truncate text-base font-black tracking-tight text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)] sm:text-lg">
          {alert.memberName}
        </span>
      </div>

      <div
        className={`rounded-2xl border border-white/40 px-4 py-3 text-center shadow-[0_6px_22px_rgba(0,0,0,0.4)] ${
          isAccount
            ? "bg-gradient-to-b from-emerald-400 to-emerald-600"
            : "bg-gradient-to-b from-sky-400 to-sky-600"
        }`}
      >
        <div className="text-[11px] font-bold tracking-wide text-white/95 sm:text-xs">{targetLabel}</div>
        <div className="mt-0.5 text-3xl font-black tabular-nums leading-none text-white drop-shadow-[0_2px_3px_rgba(0,0,0,0.45)] sm:text-4xl">
          {amountLabel}
        </div>
      </div>

      <div className="rounded-2xl border border-white/40 bg-gradient-to-b from-rose-300 to-rose-500 px-4 py-3 text-center shadow-[0_6px_22px_rgba(0,0,0,0.4)]">
        <div className="text-[11px] font-bold tracking-wide text-white/95 sm:text-xs">{labels.contribution}</div>
        <div className="mt-0.5 text-3xl font-black tabular-nums leading-none text-white drop-shadow-[0_2px_3px_rgba(0,0,0,0.45)] sm:text-4xl">
          {alert.contributionPoints.toLocaleString(locale)}
        </div>
      </div>
    </div>
  );
}
