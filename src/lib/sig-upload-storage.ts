import { readFile } from "fs/promises";
import path from "path";

export function getSigUploadPublicRoots(): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, "public"),
    path.join(cwd, ".next", "standalone", "public"),
  ];
}

/** `uploads/sigs/<uid>/<file>` 상대 경로 (앞의 uploads/sigs 제외) */
export function safeSigUploadRelativePath(segments: string[]): string | null {
  const parts = segments.map((s) => decodeURIComponent(String(s || "").trim())).filter(Boolean);
  if (parts.length < 2) return null;
  for (const p of parts) {
    if (p === "." || p === ".." || p.includes("\0")) return null;
  }
  return parts.join("/");
}

export async function readSigUploadFromPublicDisk(relUnderSigs: string): Promise<Buffer | null> {
  const clean = path.normalize(relUnderSigs).replace(/^(\.\.(\/|\\|$))+/, "");
  if (!clean || clean.startsWith("..")) return null;
  for (const root of getSigUploadPublicRoots()) {
    const full = path.resolve(root, "uploads", "sigs", clean);
    const base = path.resolve(root, "uploads", "sigs");
    if (!full.startsWith(base + path.sep)) continue;
    try {
      return await readFile(full);
    } catch {
      /* try next root */
    }
  }
  return null;
}
