/** 시그 이미지 POST /api/upload/sig-image 실패 시 사용자 안내 문구 */
export function formatSigImageUploadFailureMessage(
  status: number,
  fileSizeBytes: number,
  serverError?: string
): string {
  const raw = String(serverError || "").trim();
  const normalized = raw.toLowerCase();
  const sizeMb = (fileSizeBytes / (1024 * 1024)).toFixed(1);

  if (normalized === "unauthorized" || status === 401) {
    return "로그인이 만료되었거나 권한이 없습니다. 새로고침 후 다시 로그인해 주세요.";
  }
  if (normalized.includes("supabase_required")) {
    return "서버 이미지 저장 설정이 없습니다. EC2 자체 서버는 디스크 업로드가 기본입니다.";
  }
  if (normalized === "invalid_type") {
    return "GIF/PNG/JPG/WEBP 파일만 업로드할 수 있습니다.";
  }
  if (status === 413) {
    return (
      `서버 업로드 한도(413)입니다. 파일 ${sizeMb}MB. ` +
      "EC2 Nginx 기본 한도는 1MB입니다. SSH 접속 후 프로젝트에서 " +
      "`chmod +x deploy/ec2-nginx-upload-limit.sh && sudo ./deploy/ec2-nginx-upload-limit.sh` " +
      "실행하거나 server { } 안에 `client_max_body_size 35M;` 추가 후 `sudo nginx -t && sudo systemctl reload nginx`"
    );
  }
  if (normalized === "missing_file") {
    return "업로드할 파일을 찾지 못했습니다. 다시 선택해 주세요.";
  }
  if (status >= 500) {
    return "서버 오류로 업로드에 실패했습니다. 잠시 후 다시 시도해 주세요.";
  }
  if (raw) return raw;
  return `알 수 없는 오류(HTTP ${status})`;
}

export const SIG_UPLOAD_NGINX_413_HINT =
  "Nginx 업로드 한도(기본 1MB)로 413입니다. EC2: deploy/ec2-nginx-upload-limit.sh 실행 또는 client_max_body_size 35M; 설정 후 nginx reload.";
