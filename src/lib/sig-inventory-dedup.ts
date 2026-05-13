import type { SigItem } from "@/types";
import { ONE_SHOT_SIG_ID } from "@/lib/sig-roulette";

/** 동일 이미지 판별용(쿼리만 다른 CDN URL 등은 origin+pathname으로 묶음) */
export function normalizeSigDedupKeyImageUrl(raw: string): string {
  const s = String(raw || "").trim();
  if (!s) return "__empty_image__";
  try {
    if (s.startsWith("http://") || s.startsWith("https://")) {
      const u = new URL(s);
      const path = u.pathname.replace(/\/+$/, "") || "/";
      return `${u.origin}${path}`.toLowerCase();
    }
  } catch {
    /* 상대 경로 등 */
  }
  return s.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** 이름만 비교할 때(엑셀 업로드 중복 검사와 동일: 공백 제거 후 소문자) */
export function normalizeSigDedupKeyName(raw: string): string {
  const n = String(raw || "")
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();
  return n || "__empty_name__";
}

export function normalizeSigDedupKeyNamePrice(name: string, price: number): string {
  const n = String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
  const p = Math.max(0, Math.floor(Number(price) || 0));
  return `${n}|${p}`;
}

export type SigDedupeStrategy = "imageUrl" | "nameAndPrice";

/**
 * 시그 목록 중복 제거. `sig_one_shot` 행은 건드리지 않음.
 * 동일 키가 여러 번 나오면 **목록 순서상 첫 번째 행만 유지**.
 */
export function dedupeSigInventory(
  inventory: SigItem[],
  strategy: SigDedupeStrategy
): { nextInventory: SigItem[]; removedCount: number } {
  const seenUrl = new Set<string>();
  const seenName = new Set<string>();
  const seenNamePrice = new Set<string>();
  const out: SigItem[] = [];
  let removedCount = 0;

  for (const item of inventory) {
    if (item.id === ONE_SHOT_SIG_ID) {
      out.push(item);
      continue;
    }
    if (strategy === "imageUrl") {
      const urlKey = normalizeSigDedupKeyImageUrl(item.imageUrl);
      const nameKey = normalizeSigDedupKeyName(item.name);
      if (seenUrl.has(urlKey) || seenName.has(nameKey)) {
        removedCount++;
        continue;
      }
      seenUrl.add(urlKey);
      seenName.add(nameKey);
      out.push(item);
      continue;
    }
    const key = normalizeSigDedupKeyNamePrice(item.name, item.price);
    if (seenNamePrice.has(key)) {
      removedCount++;
      continue;
    }
    seenNamePrice.add(key);
    out.push(item);
  }

  return { nextInventory: out, removedCount };
}
