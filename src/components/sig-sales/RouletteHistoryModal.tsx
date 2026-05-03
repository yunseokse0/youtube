"use client";

import { DEFAULT_SIG_SOLD_STAMP_URL } from "@/lib/constants";
import type { SigItem } from "@/types";
import SelectedSigs from "@/components/sig-sales/SelectedSigs";
import OneShotSigCard from "@/components/sig-sales/OneShotSigCard";

type HistoryItem = {
  id: string;
  sessionId: string;
  phase: "LANDED" | "CONFIRMED" | "CANCELLED";
  selectedSigs: Array<{ id: string; name: string; price: number }>;
  oneShotPrice: number;
  totalPrice: number;
  timestamp: number;
  adminId?: string | null;
  reason?: string | null;
};

type RouletteHistoryModalProps = {
  open: boolean;
  item: HistoryItem | null;
  onClose: () => void;
  onLoadReadonly: (payload: { selectedSigs: SigItem[]; oneShot: { id: string; name: string; price: number } }) => void;
};

export default function RouletteHistoryModal({ open, item, onClose, onLoadReadonly }: RouletteHistoryModalProps) {
  if (!open || !item) return null;
  const fakeSigItems: SigItem[] = item.selectedSigs.map((x) => ({
    id: x.id,
    name: x.name,
    price: x.price,
    imageUrl: "",
    maxCount: 1,
    soldCount: 1,
    isRolling: true,
    isActive: true,
  }));
  return (
    <div className="fixed inset-0 z-[120] grid place-items-center bg-black/70 p-4">
      <div className="w-full max-w-5xl rounded-2xl border border-yellow-300/50 bg-neutral-950 p-4 text-white">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-lg font-black text-yellow-200">판매 이력 상세</h3>
            <p className="text-xs text-neutral-300">
              세션 {item.sessionId} · {new Date(item.timestamp).toLocaleString("ko-KR")}
            </p>
          </div>
          <span
            className={`rounded px-2 py-1 text-xs font-bold ${
              item.phase === "CONFIRMED"
                ? "bg-emerald-700/70 text-emerald-100"
                : item.phase === "LANDED"
                  ? "bg-amber-700/80 text-amber-50"
                  : "bg-rose-800/70 text-rose-100"
            }`}
          >
            {item.phase}
          </span>
        </div>
        <SelectedSigs
          items={fakeSigItems}
          soldOutStampUrl={DEFAULT_SIG_SOLD_STAMP_URL}
          manualSoldSet={new Set(fakeSigItems.map((x) => x.id))}
          disabled={true}
          onToggleSold={() => {}}
        />
        <div className="mt-3">
          <OneShotSigCard
            name="한방 시그"
            price={item.oneShotPrice}
            sold={true}
            soldOutStampUrl={DEFAULT_SIG_SOLD_STAMP_URL}
            disabled={true}
            onToggleSold={() => {}}
          />
        </div>
        <div className="mt-3 rounded border border-white/10 bg-black/30 p-3 text-sm">
          <div>당첨 시그: {item.selectedSigs.map((s) => s.name).join(", ") || "-"}</div>
          <div>한방 시그 금액: {item.oneShotPrice.toLocaleString("ko-KR")}원</div>
          <div>총 금액: {item.totalPrice.toLocaleString("ko-KR")}원</div>
          <div>관리자: {item.adminId || "-"}</div>
          {item.reason ? <div>사유: {item.reason}</div> : null}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() =>
              onLoadReadonly({
                selectedSigs: fakeSigItems,
                oneShot: { id: "sig_one_shot", name: "한방 시그", price: item.oneShotPrice },
              })
            }
            className="rounded bg-yellow-400 px-3 py-1.5 text-sm font-bold text-black"
          >
            이 회차 다시 불러오기
          </button>
          <button type="button" onClick={onClose} className="rounded border border-white/25 px-3 py-1.5 text-sm">
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
