import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFile } from "fs/promises";
import path from "path";

export function getSupabaseStorageConfig():
  | { url: string; serviceRoleKey: string; buckets: string[] }
  | null {
  const url = (process.env.SUPABASE_URL || "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const preferredBucket = (process.env.SUPABASE_STORAGE_BUCKET || "").trim();
  const buckets = [preferredBucket, "image", "images"]
    .filter(Boolean)
    .filter((name, idx, arr) => arr.indexOf(name) === idx);
  if (!url || !serviceRoleKey) return null;
  return { url, serviceRoleKey, buckets };
}

function createSupabaseAdmin(): SupabaseClient | null {
  const cfg = getSupabaseStorageConfig();
  if (!cfg) return null;
  return createClient(cfg.url, cfg.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

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

/** Supabase `sigs/<uid>/<file>` — 디스크에 없을 때 `/uploads/sigs/...` 요청 폴백 */
export async function readSigUploadFromSupabase(relUnderSigs: string): Promise<Buffer | null> {
  const clean = path.normalize(relUnderSigs).replace(/^(\.\.(\/|\\|$))+/, "");
  if (!clean || clean.startsWith("..")) return null;
  const supabase = createSupabaseAdmin();
  const cfg = getSupabaseStorageConfig();
  if (!supabase || !cfg) return null;
  const storagePath = `sigs/${clean.replace(/\\/g, "/")}`;
  for (const bucket of cfg.buckets) {
    const { data, error } = await supabase.storage.from(bucket).download(storagePath);
    if (!error && data) {
      return Buffer.from(await data.arrayBuffer());
    }
  }
  return null;
}

export async function readSigUploadBuffer(relUnderSigs: string): Promise<Buffer | null> {
  const disk = await readSigUploadFromPublicDisk(relUnderSigs);
  if (disk) return disk;
  return readSigUploadFromSupabase(relUnderSigs);
}
