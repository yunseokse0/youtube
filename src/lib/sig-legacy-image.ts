import { createClient } from "@supabase/supabase-js";
import { readFile } from "fs/promises";
import path from "path";

/** 업로드 API(`sig-image`)와 동일한 버킷 후보 */
function getSupabaseForLegacyRead():
  | { url: string; serviceRoleKey: string; buckets: string[] }
  | null {
  const url = (process.env.SUPABASE_URL || "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const preferredBucket = (process.env.SUPABASE_STORAGE_BUCKET || "").trim();
  const buckets = [preferredBucket, "image", "images"].filter(Boolean).filter((name, idx, arr) => arr.indexOf(name) === idx);
  if (!url || !serviceRoleKey || buckets.length === 0) return null;
  return { url, serviceRoleKey, buckets };
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

/** Storage 키는 URL과 동일하게 `images/sigs/<relPath>` 만 사용 */
export async function fetchLegacySigFromSupabase(relPath: string): Promise<Buffer | null> {
  const cfg = getSupabaseForLegacyRead();
  if (!cfg) return null;
  const supabase = createClient(cfg.url, cfg.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const objectPath = `images/sigs/${relPath}`;
  for (const bucket of cfg.buckets) {
    const { data, error } = await supabase.storage.from(bucket).download(objectPath);
    if (error || !data) continue;
    try {
      const ab = await data.arrayBuffer();
      return Buffer.from(ab);
    } catch {
      continue;
    }
  }
  return null;
}
