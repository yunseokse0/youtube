import type { AppState, Donor, SigItem } from "@/types";
import {
  coerceSigUrlToGithubBundledPath,
  isSigImagesGithubOnlyMode,
  repairLegacySigUploadPath,
} from "@/lib/sig-image-mode";
import { normalizeSigImageUrlStored } from "@/lib/constants";

/** GET/POST JSON — 시그 `imageUrl` 저장 전 경로 정규화 */
export function slimSigInventoryForWire(
  items: SigItem[] | undefined,
  userId?: string
): SigItem[] {
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    let imageUrl = normalizeSigImageUrlStored(
      repairLegacySigUploadPath(String(item.imageUrl || ""), userId)
    );
    /** 업로드 경로는 서버·OBS 동일 오리진 — 파일명만 `/images/sigs/` 로 바꾸면 404 */
    if (isSigImagesGithubOnlyMode() && !imageUrl.startsWith("/uploads/sigs/")) {
      imageUrl = coerceSigUrlToGithubBundledPath(imageUrl);
    }
    return imageUrl === item.imageUrl ? item : { ...item, imageUrl };
  });
}

export function readOverlayDonorsCap(): number {
  const raw = String(process.env.STATE_API_OVERLAY_DONORS_MAX ?? "300").trim();
  const n = parseInt(raw.replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(n) || n <= 0) return 300;
  return Math.min(5000, Math.max(50, n));
}

/** 오버레이용 — 최신 후원만(순위·티커는 보통 최근 N명으로 충분) */
export function capDonorsForOverlayWire(donors: Donor[] | undefined, max = readOverlayDonorsCap()): Donor[] {
  if (!Array.isArray(donors) || donors.length <= max) return donors || [];
  return donors
    .slice()
    .sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0))
    .slice(0, max);
}
