import { readFile } from "fs/promises";
import path from "path";
import { isSigLocalAssetsOnlyMode } from "@/lib/sig-image-mode";

function getLegacySigCdnBaseUrl(): string {
  return (process.env.SIG_CDN_BASE_URL || process.env.NEXT_PUBLIC_SIG_CDN_BASE_URL || "https://ik.imagekit.io/lwcsfeswl")
    .trim()
    .replace(/\/+$/, "");
}

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

/** `DEFAULT_SIG_INVENTORY` 등과 동일: `public/images/sigs/<relPath>` */
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

/** 레거시 파일명을 ImageKit 등 외부 CDN에서 그대로 조회 */
export async function fetchLegacySigFromCdn(relPath: string): Promise<Buffer | null> {
  if (isSigLocalAssetsOnlyMode()) return null;
  const base = getLegacySigCdnBaseUrl();
  if (!base) return null;
  const encodedPath = relPath
    .split("/")
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  if (!encodedPath) return null;
  const url = `${base}/${encodedPath}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } catch {
    return null;
  }
}
