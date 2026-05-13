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
  return v === "1" || v === "true" || v === "yes";
}
