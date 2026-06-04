import type { ManualSigDraft } from "@/lib/manual-sig-workbench";

export type ManualSigRandomPoolItem = {
  id: string;
  name: string;
  price: number;
  imageUrl: string;
};

/** 재고 풀에서 중복 없이 count개 시그 초안 생성. 풀이 부족하면 null */
export function pickRandomManualSigDrafts(
  pool: ManualSigRandomPoolItem[],
  count = 5
): ManualSigDraft[] | null {
  const need = Math.max(1, Math.floor(count));
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
  const arr = Array.from(uniq.values());
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
