/**
 * 시그 이미지 저장·표시 모드 (환경 변수).
 * - `NEXT_PUBLIC_SIG_USE_LOCAL_ASSETS`: Supabase 공개 URL 등을 동일 오리진 `/images/sigs`·`/uploads` 경로로 바꿔 요청합니다.
 * - `SIG_SERVE_SIG_IMAGES_FROM_DISK`: 업로드 시 `public/uploads/sigs/...`에 저장하고 `/uploads/...` URL 반환(프로덕션에서도 명시 시 허용).
 * - FTP 업로드·`/api/ftp/image/...` 제공은 `SIG_FTP_IMAGE_UPLOAD` 및 `src/lib/ftp-sig-storage.ts`를 참고하세요.
 *
 * 임시 차단(네트워크·404·리소스 부족 의심 시):
 * - `NEXT_PUBLIC_SIG_IMAGES_PLACEHOLDER_ONLY=1`: 클라이언트에서 커스텀 시그 이미지 URL을 모두 공용 더미로 치환(브라우저가 `/api/sig-legacy` 등을 덜 침).
 * - `SIG_LEGACY_IMAGE_API_DISABLED=1`: 서버 `/api/sig-legacy`가 디스크를 읽지 않고 503 반환.
 */

/** 임시: 커스텀 시그 이미지 요청을 막고 `dummy-sig.svg`만 쓰게 함(빌드에 포함된 경로는 유지). */
export function isSigImagesPlaceholderOnlyEnv(): boolean {
  const v = String(process.env.NEXT_PUBLIC_SIG_IMAGES_PLACEHOLDER_ONLY ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** 임시: 레거시 디스크 시그 이미지 API 자체를 끔. */
export function isSigLegacyImageApiDisabled(): boolean {
  const v = String(process.env.SIG_LEGACY_IMAGE_API_DISABLED ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function isSigLocalAssetsOnlyMode(): boolean {
  const v = String(process.env.NEXT_PUBLIC_SIG_USE_LOCAL_ASSETS ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function shouldServeSigImagesFromDisk(): boolean {
  const v = String(process.env.SIG_SERVE_SIG_IMAGES_FROM_DISK ?? "").trim().toLowerCase();
  const enabled = v === "1" || v === "true" || v === "yes";
  if (!enabled) return false;
  /** Render 디스크는 재배포 시 삭제됨 — Supabase 없이 디스크 업로드만 쓰면 404가 반복됨 */
  if (
    process.env.RENDER === "true" &&
    process.env.NODE_ENV === "production" &&
    String(process.env.SIG_SERVE_SIG_IMAGES_FROM_DISK_ON_RENDER ?? "")
      .trim()
      .toLowerCase() !== "1"
  ) {
    return false;
  }
  return true;
}

/** true 이면 Supabase·/uploads·GitHub 시그 경로 외 https URL을 저장 시 더미로 치환(구 동작) */
export function shouldStripUntrustedExternalSigImageUrls(): boolean {
  const v = String(process.env.NEXT_PUBLIC_SIG_STRIP_EXTERNAL_IMAGE_URLS ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Supabase·Render `/uploads` 없이 Git `public/images/sigs` + raw.githubusercontent 만 사용.
 * 롤링 OBS: 상태(JSON)는 변동 시만, GIF는 브라우저→GitHub 직접(캐시).
 */
export function isSigImagesGithubOnlyMode(): boolean {
  const v = String(process.env.NEXT_PUBLIC_SIG_IMAGES_GITHUB_ONLY ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** `/uploads/sigs/<uid>/<file>` → `/images/sigs/<file>` (Git 번들 경로) */
export function coerceSigUrlToGithubBundledPath(url: string): string {
  const s = String(url || "").trim();
  const m = s.match(/\/uploads\/sigs\/[^/]+\/([^?#/]+)/i);
  if (m?.[1]) return `/images/sigs/${m[1]}`;
  return s;
}

/** PC 디스크 업로드 파일명 패턴 (업로드 API: `${Date.now()}_${uuid8}.ext`) */
const DISK_UPLOAD_FILE_PATTERN = /^(\d+_[a-z0-9]{8}\.(?:gif|png|jpe?g|webp))$/i;

export function isDiskUploadFlatFileName(fileName: string): boolean {
  const s = String(fileName || "").trim();
  const i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
  const base = i >= 0 ? s.slice(i + 1) : s;
  return DISK_UPLOAD_FILE_PATTERN.test(base);
}

/**
 * GitHub-only 모드에서 `/uploads/sigs/…` 가 `/images/sigs/<file>` 로 잘못 저장된 경우
 * 동일 파일명으로 디스크 경로 복구.
 */
export function repairDiskUploadSigImagePath(stored: string, userId?: string): string {
  const s = String(stored || "").trim();
  if (!s) return s;
  if (s.startsWith("/uploads/sigs/")) return s;

  let fileName: string | null = null;
  const flat = s.match(/^\/images\/sigs\/([^/?#]+)$/i);
  if (flat?.[1] && DISK_UPLOAD_FILE_PATTERN.test(flat[1])) fileName = flat[1];

  const gh = s.match(/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/public\/images\/sigs\/([^/?#]+)/i);
  if (gh?.[1] && DISK_UPLOAD_FILE_PATTERN.test(gh[1])) fileName = gh[1];

  if (!fileName) return s;
  const safeUid = String(userId || "").replace(/[^a-zA-Z0-9_-]/g, "_");
  if (!safeUid) return s;
  return `/uploads/sigs/${safeUid}/${fileName}`;
}

/** 미들웨어: 디스크 업로드 flat 경로(`/images/sigs/<timestamp>_<id>.ext`) 여부 */
export function isDiskUploadFlatSigImagePath(pathname: string): boolean {
  const m = String(pathname || "").match(/^\/images\/sigs\/([^/?#]+)$/i);
  return Boolean(m?.[1] && isDiskUploadFlatFileName(m[1]));
}

/**
 * Render 대역폭 절감용 GitHub raw 우회.
 * AWS·자체 서버 디스크 업로드 또는 `NEXT_PUBLIC_SIG_ROLLING_GITHUB_BASE=off` 이면 비활성.
 */
export function shouldOffloadSigImagesToGithubRaw(): boolean {
  const rollingOff = String(process.env.NEXT_PUBLIC_SIG_ROLLING_GITHUB_BASE ?? "").trim().toLowerCase();
  if (rollingOff === "0" || rollingOff === "off") return false;
  if (shouldServeSigImagesFromDisk()) return false;
  if (isSigImagesGithubOnlyMode()) return true;
  if (process.env.RENDER === "true" && process.env.NODE_ENV === "production") return true;
  const customBase = String(process.env.NEXT_PUBLIC_SIG_ROLLING_GITHUB_BASE ?? "").trim();
  if (customBase) return true;
  return false;
}
