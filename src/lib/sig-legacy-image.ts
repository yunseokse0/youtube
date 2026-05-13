import { readFile } from "fs/promises";
import path from "path";

/**
 * 번들 시그 정적 파일(디스크 읽기).
 * - GIF·SVG 등: `public/images/sigs/<하위>/파일` (예: `siggif/foo.gif`, `from-drive/…`)
 * - `next.config.js` 가 `/images/sigs/:path*` 를 `/api/sig-legacy/:path*` 로 넘기므로, 브라우저는
 *   `/images/sigs/…` 만 쓰면 이 모듈이 디스크에서 스트림합니다.
 * - 완판 스탬프 등 `public/img/…` 는 Next 가 `public` 에서 그대로 제공합니다(`/img/…` URL, 이 파일 미사용).
 */

export function mimeFromFileName(fileName: string): string {
  const l = fileName.toLowerCase();
  if (l.endsWith(".gif")) return "image/gif";
  if (l.endsWith(".png")) return "image/png";
  if (l.endsWith(".jpg") || l.endsWith(".jpeg")) return "image/jpeg";
  if (l.endsWith(".webp")) return "image/webp";
  if (l.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

export function safeSigLegacyRelativePath(segments: string[]): string | null {
  const parts = segments.map((s) => decodeURIComponent(String(s || "").trim())).filter(Boolean);
  if (!parts.length) return null;
  for (const p of parts) {
    if (p === "." || p === "..") return null;
    if (p.includes("\0")) return null;
  }
  return parts.join("/");
}

/** `public/images/sigs/<relPath>` — 하위 폴더 `siggif`, `from-drive` 등 동일 규칙 */
export async function readLegacySigFromPublicDisk(relPath: string): Promise<Buffer | null> {
  const cwd = process.cwd();
  const root = path.resolve(cwd, "public", "images", "sigs");
  const cleanRel = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const full = path.resolve(root, cleanRel);
  if (!full.startsWith(root + path.sep) && full !== root) return null;
  try {
    return await readFile(full);
  } catch {
    return null;
  }
}
