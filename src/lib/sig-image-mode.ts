/**
 * 시그 이미지 저장·표시 모드 (환경 변수).
 * - `NEXT_PUBLIC_SIG_USE_LOCAL_ASSETS`: Supabase 공개 URL 등을 동일 오리진 `/images/sigs`·`/uploads` 경로로 바꿔 요청합니다.
 * - `SIG_SERVE_SIG_IMAGES_FROM_DISK`: 업로드 시 `public/uploads/sigs/...`에 저장하고 `/uploads/...` URL 반환(프로덕션에서도 명시 시 허용).
 * - FTP 업로드·`/api/ftp/image/...` 제공은 `SIG_FTP_IMAGE_UPLOAD` 및 `src/lib/ftp-sig-storage.ts`를 참고하세요.
 */

export function isSigLocalAssetsOnlyMode(): boolean {
  const v = String(process.env.NEXT_PUBLIC_SIG_USE_LOCAL_ASSETS ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function shouldServeSigImagesFromDisk(): boolean {
  const v = String(process.env.SIG_SERVE_SIG_IMAGES_FROM_DISK ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}
