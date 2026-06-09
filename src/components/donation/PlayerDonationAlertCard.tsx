"use client";

import { useMemo } from "react";
import { resolveSigOverlayCardImageUrl } from "@/lib/constants";

export type PlayerDonationAlertData = {
  donorName: string;
  playerName?: string;
  amount: number;
  message: string;
  matchedSigName?: string;
  matchedSigImageUrl?: string;
  isAutoMatched?: boolean;
};

type Props = {
  alert: PlayerDonationAlertData;
  userId: string;
  onClose?: () => void;
  density?: "default" | "stack";
  highlighted?: boolean;
};

export default function PlayerDonationAlertCard({
  alert,
  userId,
  onClose,
  density = "default",
  highlighted = false,
}: Props) {
  const stack = density === "stack";
  const sigImageSrc = useMemo(() => {
    if (!alert.matchedSigName) return "";
    return resolveSigOverlayCardImageUrl(alert.matchedSigName, alert.matchedSigImageUrl, userId);
  }, [alert.matchedSigImageUrl, alert.matchedSigName, userId]);

  const sigTitle = useMemo(() => {
    if (!alert.matchedSigName) return "시그 후원";
    if (alert.isAutoMatched) return alert.matchedSigName;
    return `${alert.matchedSigName} (추정)`;
  }, [alert.isAutoMatched, alert.matchedSigName]);

  const playerLabel = alert.playerName?.trim() || "—";

  return (
    <div
      className={`relative w-full overflow-hidden rounded-2xl border-2 bg-slate-950 shadow-[0_12px_48px_rgba(0,0,0,0.5)] ${
        highlighted ? "border-sky-400 ring-2 ring-sky-400/40" : "border-yellow-400/90"
      } ${stack ? "rounded-xl shadow-lg" : "max-w-2xl"}`}
    >
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          className="absolute right-2 top-2 z-10 rounded-full bg-black/55 px-2 py-0.5 text-xs text-neutral-300 hover:bg-black/75 hover:text-white"
          aria-label="닫기"
        >
          ✕
        </button>
      ) : null}

      <div className={`flex flex-row items-stretch ${stack ? "min-h-[6.5rem]" : "min-h-[8.5rem]"}`}>
        <div
          className={`flex shrink-0 items-center justify-center border-r border-yellow-400/25 bg-black/45 p-2 ${
            stack ? "w-[4.5rem]" : "w-28 sm:w-32"
          }`}
        >
          {sigImageSrc ? (
            <div
              className={`relative aspect-[3/4] w-full overflow-hidden rounded-lg border border-yellow-400/40 bg-black/50 ${
                stack ? "max-h-[5.5rem]" : "max-h-[7rem]"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={sigImageSrc}
                alt={alert.matchedSigName || "시그"}
                className="h-full w-full object-contain"
              />
            </div>
          ) : (
            <div
              className={`flex aspect-[3/4] w-full max-h-[5.5rem] items-center justify-center rounded-lg border border-dashed border-slate-600 bg-slate-900/80 ${
                stack ? "text-xl" : "text-2xl"
              }`}
            >
              🎁
            </div>
          )}
        </div>

        <div className={`flex min-w-0 flex-1 flex-row items-center gap-3 ${stack ? "px-2.5 py-2" : "gap-4 px-3 py-2.5"}`}>
          <div className={`shrink-0 ${onClose ? "pr-6" : ""}`}>
            <p className="text-[9px] font-semibold uppercase tracking-wider text-emerald-300/70">플레이어</p>
            <p
              className={`max-w-[7.5rem] truncate font-black leading-none text-emerald-50 sm:max-w-[9rem] ${
                stack ? "text-2xl" : "text-3xl sm:text-4xl"
              }`}
            >
              {playerLabel}
            </p>
          </div>

          <div className="hidden h-10 w-px shrink-0 bg-yellow-400/20 sm:block" aria-hidden />

          <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
            <p className="text-[9px] font-bold tracking-wide text-yellow-300/80">시그 판매 안내</p>
            <p className={`truncate font-bold text-yellow-100 ${stack ? "text-xs" : "text-sm"}`}>{sigTitle}</p>
            <p className={`truncate ${stack ? "text-[11px]" : "text-xs"}`}>
              <span className="font-semibold text-cyan-100">{alert.donorName}</span>
              <span className="ml-1.5 tabular-nums font-semibold text-yellow-200">
                {alert.amount.toLocaleString("ko-KR")}원
              </span>
            </p>
            {alert.message ? (
              <p
                className={`line-clamp-2 whitespace-pre-wrap break-words leading-snug text-slate-300 ${
                  stack ? "text-[10px]" : "text-xs line-clamp-3"
                }`}
              >
                {alert.message}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
