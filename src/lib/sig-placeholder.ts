import type { SigItem } from "@/types";

/** `constants.ts` DEFAULT_SIG_INVENTORY 과 동일 id (순환 import 방지) */
const DEFAULT_PLACEHOLDER_SIG_IDS = new Set([
  "sig_aegyo",
  "sig_dance",
  "sig_meal",
  "sig_voice",
  "sig_song",
  "sig_talk",
  "sig_heart",
  "sig_game",
]);

/** Git 기본·샘플 시그(더미 SVG) — 실방송 회전판·결과 후보에서 제외 */
export function isBundledSigPlaceholderItem(
  item: Pick<SigItem, "id" | "imageUrl"> | null | undefined
): boolean {
  if (!item) return false;
  const id = String(item.id || "").trim();
  const imageUrl = String(item.imageUrl || "").toLowerCase();
  return DEFAULT_PLACEHOLDER_SIG_IDS.has(id) || imageUrl.includes("dummy-sig.svg");
}

export function stripBundledSigPlaceholderItems<T extends Pick<SigItem, "id" | "imageUrl">>(
  items: T[] | null | undefined
): T[] {
  if (!Array.isArray(items)) return [];
  return items.filter((x) => x && !isBundledSigPlaceholderItem(x));
}
