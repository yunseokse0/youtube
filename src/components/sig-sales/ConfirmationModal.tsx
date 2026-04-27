"use client";

import { motion } from "framer-motion";

type ConfirmationModalProps = {
  open: boolean;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function ConfirmationModal({ open, loading, onCancel, onConfirm }: ConfirmationModalProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/60 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-xl rounded-2xl border border-yellow-300/55 bg-neutral-900 p-5 text-white shadow-[0_0_30px_rgba(250,204,21,0.25)]"
      >
        <h3 className="text-lg font-black text-yellow-200">판매 확정 확인</h3>
        <p className="mt-2 text-sm text-neutral-200">선정된 5개 시그 + 한방 시그을 판매 확정하시겠습니까?</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={onCancel}
            className="rounded border border-white/20 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={onConfirm}
            className="rounded bg-yellow-400 px-3 py-1.5 text-sm font-bold text-black disabled:opacity-60"
          >
            {loading ? "처리 중..." : "확정하기"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
