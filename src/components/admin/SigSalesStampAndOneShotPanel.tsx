"use client";

import {
  DEFAULT_ONE_SHOT_SIG_BUNDLED_IMAGE,
  DEFAULT_SIG_SOLD_STAMP_URL,
  resolveSigAdminPreviewSrc,
} from "@/lib/constants";

type SigSalesStampAndOneShotPanelProps = {
  userId: string;
  stampUrl: string;
  oneShotImageUrl: string;
  busy?: boolean;
  onStampFile: (file: File | null) => void;
  onResetStamp: () => void;
  onOneShotFile: (file: File | null) => void;
};

export default function SigSalesStampAndOneShotPanel({
  userId,
  stampUrl,
  oneShotImageUrl,
  busy = false,
  onStampFile,
  onResetStamp,
  onOneShotFile,
}: SigSalesStampAndOneShotPanelProps) {
  const stampSrc = resolveSigAdminPreviewSrc(stampUrl || DEFAULT_SIG_SOLD_STAMP_URL, "stamp", userId);
  const oneShotSrc = resolveSigAdminPreviewSrc(
    oneShotImageUrl || DEFAULT_ONE_SHOT_SIG_BUNDLED_IMAGE,
    "한방 시그",
    userId
  );

  return (
    <section className="space-y-3 rounded-xl border border-yellow-400/25 bg-yellow-950/15 p-4">
      <p className="text-sm font-semibold text-yellow-100">판매 완료 · 한방 시그</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2 rounded border border-white/10 bg-black/30 p-2">
          <p className="text-xs font-semibold text-neutral-200">판매 완료 이미지</p>
          <p className="text-[11px] text-neutral-500">완판 시 시그 정중앙에 겹칩니다.</p>
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={stampSrc} alt="판매 완료 미리보기" className="h-14 w-14 rounded border border-white/10 object-contain bg-black/40" />
            <div className="flex flex-col gap-1">
              <label className="cursor-pointer rounded bg-indigo-800 px-2 py-1 text-xs hover:bg-indigo-700">
                {busy ? "처리 중…" : "이미지 업로드"}
                <input
                  className="hidden"
                  type="file"
                  accept=".gif,.png,.jpg,.jpeg,.webp,image/gif,image/png,image/jpeg,image/webp"
                  disabled={busy}
                  onChange={(e) => {
                    onStampFile(e.target.files?.[0] || null);
                    e.currentTarget.value = "";
                  }}
                />
              </label>
              <button
                type="button"
                disabled={busy}
                className="rounded bg-neutral-700 px-2 py-1 text-xs hover:bg-neutral-600 disabled:opacity-50"
                onClick={onResetStamp}
              >
                기본 도장
              </button>
            </div>
          </div>
        </div>
        <div className="space-y-2 rounded border border-white/10 bg-black/30 p-2">
          <p className="text-xs font-semibold text-neutral-200">한방 시그 이미지</p>
          <p className="text-[11px] text-neutral-500">OBS 한방 카드에 표시됩니다. 금액은 당첨 합산입니다.</p>
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={oneShotSrc} alt="한방 시그 미리보기" className="h-14 w-14 rounded border border-white/10 object-contain bg-black/40" />
            <label className="cursor-pointer rounded bg-emerald-800 px-2 py-1 text-xs hover:bg-emerald-700">
              {busy ? "처리 중…" : "한방 이미지 업로드"}
              <input
                className="hidden"
                type="file"
                accept=".gif,.png,.jpg,.jpeg,.webp,image/gif,image/png,image/jpeg,image/webp"
                disabled={busy}
                onChange={(e) => {
                  onOneShotFile(e.target.files?.[0] || null);
                  e.currentTarget.value = "";
                }}
              />
            </label>
          </div>
        </div>
      </div>
    </section>
  );
}
