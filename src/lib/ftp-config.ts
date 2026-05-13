/**
 * FileZilla Server 등 FTP 접속 설정 (목록·시그 이미지 업/다운로드 공통).
 * 환경 변수: FTP_HOST, FTP_USER, FTP_PASSWORD, FTP_PORT, FTP_SECURE
 */

export type FtpAccessConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  secure: boolean | "implicit";
};

export function getFtpAccessConfig(): FtpAccessConfig | null {
  const host = (process.env.FTP_HOST || "").trim();
  const user = (process.env.FTP_USER || "").trim();
  const password = (process.env.FTP_PASSWORD || "").trim();
  if (!host || !user || !password) return null;
  const portRaw = (process.env.FTP_PORT || "21").trim();
  const port = Math.max(1, Math.min(65535, parseInt(portRaw, 10) || 21));
  const secureRaw = (process.env.FTP_SECURE || "").trim().toLowerCase();
  const secure =
    secureRaw === "implicit"
      ? "implicit"
      : secureRaw === "true" || secureRaw === "1" || secureRaw === "explicit";
  return { host, port, user, password, secure };
}

/** 「FTP 폴더 보기」용 원격 경로 (.. 등 차단) */
export function safeFtpRemotePathForBrowse(raw: string | null): string {
  const s = String(raw ?? "/").trim().replace(/\\/g, "/") || "/";
  let p = s.startsWith("/") ? s : `/${s}`;
  const segments = p.split("/").filter(Boolean);
  for (const seg of segments) {
    if (seg === "." || seg === "..") {
      throw new Error("invalid_path");
    }
  }
  return segments.length ? `/${segments.join("/")}` : "/";
}
