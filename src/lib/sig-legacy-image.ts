import { readFile } from "fs/promises";
import path from "path";

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
