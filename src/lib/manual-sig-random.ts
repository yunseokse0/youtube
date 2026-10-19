import type { ManualSigDraft, ManualSigSlotPriceBand } from "@/lib/manual-sig-workbench";
import { priceMatchesManualSigSlotBand } from "@/lib/manual-sig-workbench";

export type ManualSigRandomPoolItem = {
  id: string;
  name: string;
  price: number;
  imageUrl: string;
};

function uniqPoolItems(pool: ManualSigRandomPoolItem[]): ManualSigRandomPoolItem[] {
  const uniq = new Map<string, ManualSigRandomPoolItem>();
  for (const row of pool) {
    const id = String(row.id || "").trim();
    if (!id) continue;
    const name = String(row.name || "").trim();
    if (!name) continue;
    const price = Math.max(0, Math.floor(Number(row.price || 0)));
    if (price <= 0) continue;
    uniq.set(id, {
      id,
      name,
      price,
      imageUrl: String(row.imageUrl || "").trim(),
    });
  }
  return Array.from(uniq.values());
}

/** 재고 풀에서 중복 없이 count개 시그 초안 생성. 풀이 부족하면 null */
export function pickRandomManualSigDrafts(
  pool: ManualSigRandomPoolItem[],
  count = 5
): ManualSigDraft[] | null {
  const need = Math.max(1, Math.floor(count));
  const arr = uniqPoolItems(pool);
  if (arr.length < need) return null;
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, need).map((p) => ({
    sourceSigId: p.id,
    name: p.name,
    priceInput: String(p.price),
    imageUrl: p.imageUrl,
  }));
}

/** 칸별 금액대에 맞는 시그를 중복 없이 1칸씩 추첨. 부족하면 null */
export function pickRandomManualSigDraftsBySlotBands(
  pool: ManualSigRandomPoolItem[],
  bands: ManualSigSlotPriceBand[]
): ManualSigDraft[] | null {
  const need = bands.length;
  if (need < 1) return null;
  const arr = uniqPoolItems(pool);
  if (arr.length < need) return null;
  const used = new Set<string>();
  const out: ManualSigDraft[] = [];
  for (const band of bands) {
    const candidates = arr.filter(
      (p) => !used.has(p.id) && priceMatchesManualSigSlotBand(p.price, band)
    );
    if (candidates.length === 0) return null;
    const pick = candidates[Math.floor(Math.random() * candidates.length)]!;
    used.add(pick.id);
    out.push({
      sourceSigId: pick.id,
      name: pick.name,
      priceInput: String(pick.price),
      imageUrl: pick.imageUrl,
    });
  }
  return out;
}
