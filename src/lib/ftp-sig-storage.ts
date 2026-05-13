import { Client } from "basic-ftp";
import path from "path";
import { Readable, Writable } from "stream";
import { getFtpAccessConfig } from "@/lib/ftp-config";

/** true 이면 시그 이미지 업로드 시 FTP에 저장하고 `/api/ftp/image/...` URL을 반환합니다. */
export function shouldServeSigImagesFromFtp(): boolean {
  const v = String(process.env.SIG_FTP_IMAGE_UPLOAD ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** FTP 루트 아래 시그 저장 위치 (예: `/web/siggif` 또는 빈 문자열이면 `/sigs/...`) */
function getFtpSigBasePath(): string {
  return String(process.env.FTP_SIG_BASE_PATH ?? "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
}

/** FTP 서버 상 절대 경로: `[FTP_SIG_BASE_PATH]/sigs/<uid>/<file>` */
export function ftpRemotePathForSigAsset(safeUid: string, fileName: string): string {
  const base = getFtpSigBasePath();
  const rel = path.posix.join("sigs", safeUid, fileName);
  const joined = base ? path.posix.join(base, rel) : `/${rel}`;
  const norm = joined.replace(/\\/g, "/");
  const withSlash = norm.startsWith("/") ? norm : `/${norm}`;
  return "/" + withSlash.split("/").filter(Boolean).join("/");
}

/** 브라우저·오버레이용 동일 오리진 URL 경로 */
export function ftpPublicImageUrlPath(safeUid: string, fileName: string): string {
  return `/api/ftp/image/sigs/${safeUid}/${encodeURIComponent(fileName)}`;
}

export async function uploadSigBufferToFtp(remotePath: string, data: Buffer): Promise<void> {
  const cfg = getFtpAccessConfig();
  if (!cfg) throw new Error("ftp_not_configured");
  const client = new Client();
  client.ftp.verbose = false;
  try {
    await client.access(cfg);
    const dir = path.posix.dirname(remotePath);
    await client.ensureDir(dir);
    await client.uploadFrom(Readable.from([data]), remotePath);
  } finally {
    client.close();
  }
}

export async function downloadSigBufferFromFtp(remotePath: string): Promise<Buffer | null> {
  const cfg = getFtpAccessConfig();
  if (!cfg) return null;
  const client = new Client();
  client.ftp.verbose = false;
  const chunks: Buffer[] = [];
  const writable = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      cb();
    },
  });
  try {
    await client.access(cfg);
    await client.downloadTo(writable, remotePath);
  } catch {
    return null;
  } finally {
    client.close();
  }
  return chunks.length ? Buffer.concat(chunks) : null;
}
