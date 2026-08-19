import type { SigItem } from "@/types";
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
