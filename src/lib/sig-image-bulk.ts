import { BUNDLED_SIG_PLACEHOLDER_URL } from "@/lib/constants";
import { ONE_SHOT_SIG_ID } from "@/lib/sig-roulette";
import type { SigItem } from "@/types";

export function sigImageFileBaseName(fileName: string): string {
  return String(fileName || "")
    .replace(/\.[^.\\/]+$/, "")
    .trim();
}

function normalizeSigMatchKey(s: string): string {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[_-]+/g, "");
}

/** 파일명(확장자 제외)과 시그 이름으로 매칭 */
export function matchSigInventoryItemByFileName(items: SigItem[], fileName: string): SigItem | undefined {
  const base = normalizeSigMatchKey(sigImageFileBaseName(fileName));
  if (!base) return undefined;
  const exact = items.find((m) => normalizeSigMatchKey(m.name) === base);
  if (exact) return exact;
  const fuzzy = items.filter((m) => {
    const n = normalizeSigMatchKey(m.name);
    if (!n) return false;
    return base.includes(n) || n.includes(base);
  });
  if (fuzzy.length === 1) return fuzzy[0];
  return undefined;
}

export function isSigInventoryImageNeedsReupload(item: SigItem): boolean {
  const raw = String(item.imageUrl || "").trim();
  if (!raw) return true;
  if (raw === BUNDLED_SIG_PLACEHOLDER_URL) return true;
  const lower = raw.toLowerCase();
  if (lower.startsWith("/uploads/") || lower.includes(".onrender.com/uploads/")) return true;
  if (lower.includes("dummy-sig.svg")) return true;
  return false;
}

export type SigBulkReuploadPlan = { file: File; item: SigItem; matchedBy: "name" | "fallback" };

/** 파일 → 시그 행 매핑(이름 우선, 남는 파일은 재업로드 필요 행 순) */
export function planSigBulkReupload(files: File[], items: SigItem[]): SigBulkReuploadPlan[] {
  const inventory = items.filter((x) => x.id !== ONE_SHOT_SIG_ID);
  const usedIds = new Set<string>();
  const plans: SigBulkReuploadPlan[] = [];
  const unmatchedFiles: File[] = [];

  for (const file of files) {
    const hit = matchSigInventoryItemByFileName(inventory, file.name);
    if (hit && !usedIds.has(hit.id)) {
      usedIds.add(hit.id);
      plans.push({ file, item: hit, matchedBy: "name" });
    } else {
      unmatchedFiles.push(file);
    }
  }

  const fallbackTargets = inventory.filter((m) => !usedIds.has(m.id) && isSigInventoryImageNeedsReupload(m));
  let fi = 0;
  for (const file of unmatchedFiles) {
    const target = fallbackTargets[fi];
    if (!target) break;
    if (usedIds.has(target.id)) {
      fi += 1;
      continue;
    }
    usedIds.add(target.id);
    plans.push({ file, item: target, matchedBy: "fallback" });
    fi += 1;
  }

  return plans;
}
