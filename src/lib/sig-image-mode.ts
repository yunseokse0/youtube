/**
 * 시그 이미지 저장·표시 모드 (환경 변수).
 * - `NEXT_PUBLIC_SIG_USE_LOCAL_ASSETS`: ImageKit 등 외부 CDN으로 URL을 바꾸지 않고 `/images/sigs`·`/uploads` 등 동일 오리진 경로만 사용.
 * - `SIG_SERVE_SIG_IMAGES_FROM_DISK`: 업로드 시 ImageKit보다 우선해 `public/uploads/sigs/...`에 저장하고 `/uploads/...` URL 반환(프로덕션에서도 명시 시 허용).
 */

export function isSigLocalAssetsOnlyMode(): boolean {
  const v = String(process.env.NEXT_PUBLIC_SIG_USE_LOCAL_ASSETS ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function shouldServeSigImagesFromDisk(): boolean {
  const v = String(process.env.SIG_SERVE_SIG_IMAGES_FROM_DISK ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}
