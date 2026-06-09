"use client";

import PlayerDonationAlertCard from "@/components/donation/PlayerDonationAlertCard";
import type { PlayerDonationQueueItem } from "@/lib/donation/player-alert-queue";

type Props = {
  items: PlayerDonationQueueItem[];
  userId: string;
  highlightedIds?: ReadonlySet<string>;
};

export default function PlayerDonationQueueSideStack({ items, userId, highlightedIds }: Props) {
  if (items.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-row items-end gap-3 overflow-x-auto p-3 pb-4 sm:justify-center sm:px-4">
      {items.map((item, index) => (
        <div
          key={item.id}
          className="pointer-events-auto w-[min(92vw,22rem)] shrink-0 animate-slideInUp sm:w-[20rem]"
          style={{ animationDelay: `${Math.min(index, 6) * 45}ms` }}
        >
          <PlayerDonationAlertCard
            alert={item}
            userId={userId}
            density="stack"
            highlighted={highlightedIds?.has(item.id)}
          />
        </div>
      ))}
    </div>
  );
}
