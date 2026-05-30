import { BUNDLED_SIG_PLACEHOLDER_URL } from "@/lib/constants";
import { isDiskUploadFlatFileName } from "@/lib/sig-image-mode";
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

/** EC2·디스크 업로드 API가 만든 `/uploads/sigs/<uid>/<timestamp>_<id>.ext` */
export function isPersistedDiskSigUploadUrl(raw: string): boolean {
  const s = String(raw || "")
    .trim()
    .replace(/\\/g, "/");
  const m = s.match(/^\/uploads\/sigs\/[^/]+\/([^/?#]+)$/i);
  if (!m?.[1]) return false;
  return isDiskUploadFlatFileName(m[1]);
}

/** 파일명(확장자 제외)과 시그 이름 **완전 일치**만 허용(부분 일치·순서 매칭으로 덮어쓰지 않음) */
export function matchSigInventoryItemByFileName(items: SigItem[], fileName: string): SigItem | undefined {
  const base = normalizeSigMatchKey(sigImageFileBaseName(fileName));
  if (!base) return undefined;
  return items.find((m) => normalizeSigMatchKey(m.name) === base);
}

export function isSigInventoryImageNeedsReupload(item: SigItem): boolean {
  const raw = String(item.imageUrl || "").trim();
  if (!raw) return true;
  if (raw === BUNDLED_SIG_PLACEHOLDER_URL) return true;
  if (isPersistedDiskSigUploadUrl(raw)) return false;
  const lower = raw.toLowerCase();
  if (lower.includes("dummy-sig.svg")) return true;
  /** 레거시 flat `/uploads/images/…` · Render 비영구 업로드 */
  if (lower.startsWith("/uploads/") && !lower.startsWith("/uploads/sigs/")) return true;
  if (lower.includes(".onrender.com/uploads/")) return true;
  /** `/uploads/sigs/…` 이지만 타임스탬프 패턴이 아닌 오래된 경로 */
  if (lower.startsWith("/uploads/sigs/")) return true;
  return false;
}

export type SigBulkReuploadPlan = { file: File; item: SigItem; matchedBy: "name" };

/** 파일 → 시그 행: **파일명=시그 이름** 일치할 때만 기존 행 갱신(순서·퍼지 매칭 없음) */
export function planSigBulkReupload(files: File[], items: SigItem[]): SigBulkReuploadPlan[] {
  const inventory = items.filter((x) => x.id !== ONE_SHOT_SIG_ID);
  const usedIds = new Set<string>();
  const plans: SigBulkReuploadPlan[] = [];

  for (const file of files) {
    const hit = matchSigInventoryItemByFileName(inventory, file.name);
    if (hit && !usedIds.has(hit.id)) {
      usedIds.add(hit.id);
      plans.push({ file, item: hit, matchedBy: "name" });
    }
  }

  return plans;
}

/** planSigBulkReupload 에 포함되지 않은 파일 */
export function sigBulkFilesWithoutNameMatch(files: File[], plans: SigBulkReuploadPlan[]): File[] {
  const matched = new Set(plans.map((p) => p.file));
  return files.filter((f) => !matched.has(f));
}
