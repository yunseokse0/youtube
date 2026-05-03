"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import ResultOverlay from "@/components/sig-sales/ResultOverlay";
import { DEFAULT_SIG_SOLD_STAMP_URL, resolveSigImageUrl } from "@/lib/constants";
import { canonicalSigIdFromWheelSliceId, ONE_SHOT_SIG_ID } from "@/lib/sig-roulette";
import type { SigItem } from "@/types";

const DUMMY_SIG_IMAGE = "/images/sigs/dummy-sig.svg";

function buildPreviewSigs(count: number): SigItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `preview_${i + 1}`,
    name: `예비 시그 ${i + 1}`,
    price: (i + 1) * 40000,
    imageUrl: DUMMY_SIG_IMAGE,
    maxCount: 10,
    soldCount: 0,
    isRolling: true,
    isActive: true,
  }));
}

export default function SigSalesResultPreviewPage() {
  const sp = useSearchParams();
  const count = useMemo(() => {
    const n = parseInt(String(sp.get("count") || "5").replace(/[^\d]/g, ""), 10);
    return Math.max(1, Math.min(12, Number.isFinite(n) ? n : 5));
  }, [sp]);
  const sold =
    sp.get("sold") === "1" ||
    String(sp.get("sold") || "").toLowerCase() === "true";
  const noOneShot =
    sp.get("noOneShot") === "1" ||
    String(sp.get("noOneShot") || "").toLowerCase() === "true";

  const selectedSigs = useMemo(() => buildPreviewSigs(count), [count]);
  const oneShot = useMemo(() => {
    if (noOneShot) return null;
    const price = selectedSigs.reduce((sum, x) => sum + x.price, 0);
    return { name: "한방 시그", price };
  }, [noOneShot, selectedSigs]);

  const soldOverrideSet = useMemo(() => {
    if (!sold) return undefined;
    const next = new Set<string>();
    for (const item of selectedSigs) {
      next.add(item.id);
      next.add(canonicalSigIdFromWheelSliceId(item.id));
    }
    next.add(ONE_SHOT_SIG_ID);
    next.add(canonicalSigIdFromWheelSliceId(ONE_SHOT_SIG_ID));
    return next;
  }, [sold, selectedSigs]);

  const signImageUrl = useMemo(
    () => resolveSigImageUrl("한방 시그", DUMMY_SIG_IMAGE),
    [],
  );

  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center bg-black px-3 py-6 text-white md:px-6">
      <ResultOverlay
        visible
        selectedSigs={selectedSigs}
        soldOutStampUrl={DEFAULT_SIG_SOLD_STAMP_URL}
        soldOverrideSet={soldOverrideSet}
        oneShot={oneShot}
        signImageUrl={signImageUrl}
        showOneShotReveal={Boolean(oneShot)}
        className="w-full"
        gifDelayMultiplier={1}
        entranceOnlyLatest={false}
        skipHanbangSignLoadingOverlay
      />
    </main>
  );
}
