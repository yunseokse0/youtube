import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readdir, readFile } from "fs/promises";
import path from "path";
import { isDiskUploadFlatFileName } from "@/lib/sig-image-mode";

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

/**
 * EC2·자체 서버: git pull / npm run build 후에도 업로드가 남도록 프로젝트 밖 경로.
 * SIG_UPLOADS_DATA_DIR — 그 안에 uploads/sigs/<계정>/ 구조로 저장 (public 과 동일).
 * 미설정 시 Linux 프로덕션(Render 제외)은 /var/lib/finalent 를 추가 시도.
 */
export function getSigUploadPersistentDataDir(): string | null {
  const explicit = (process.env.SIG_UPLOADS_DATA_DIR || "").trim();
  if (explicit) return path.resolve(explicit);
  if (
    process.env.NODE_ENV === "production" &&
    process.env.RENDER !== "true" &&
    process.platform !== "win32"
  ) {
    return "/var/lib/finalent";
  }
  return null;
}

export function getSigUploadPublicRoots(): string[] {
  const cwd = process.cwd();
  const roots: string[] = [];
  const persistent = getSigUploadPersistentDataDir();
  if (persistent) roots.push(persistent);
  roots.push(path.join(cwd, "public"), path.join(cwd, ".next", "standalone", "public"));
  return [...new Set(roots.map((r) => path.resolve(r)))];
}

/** uploads/sigs/<uid>/<file> 상대 경로 (앞의 uploads/sigs 제외) */
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

/** Supabase sigs/<uid>/<file> — 디스크에 없을 때 /uploads/sigs/... 요청 폴백 */
export async function readSigUploadFromSupabase(relUnderSigs: string): Promise<Buffer | null> {
  const clean = path.normalize(relUnderSigs).replace(/^(\.\.(\/|\\|$))+/, "");
  if (!clean || clean.startsWith("..")) return null;
  const supabase = createSupabaseAdmin();
  const cfg = getSupabaseStorageConfig();
  if (!supabase || !cfg) return null;
  const storagePath = "sigs/" + clean.replace(/\\/g, "/");
  for (const bucket of cfg.buckets) {
    const { data, error } = await supabase.storage.from(bucket).download(storagePath);
    if (!error && data) {
      return Buffer.from(await data.arrayBuffer());
    }
  }
  return null;
}

/** uploads/images/<file> 또는 uploads/sigs 하위 모든 uid 폴더에서 파일명만으로 검색 */
export async function readSigUploadByFileName(fileName: string): Promise<Buffer | null> {
  const base = String(fileName || "").trim();
  if (!base || base.includes("/") || base.includes("..")) return null;
  for (const root of getSigUploadPublicRoots()) {
    const flat = path.join(root, "uploads", "images", base);
    try {
      return await readFile(flat);
    } catch {
      /* try sigs dirs */
    }
    const sigsRoot = path.join(root, "uploads", "sigs");
    try {
      const uidDirs = await readdir(sigsRoot, { withFileTypes: true });
      for (const ent of uidDirs) {
        if (!ent.isDirectory()) continue;
        try {
          return await readFile(path.join(sigsRoot, ent.name, base));
        } catch {
          /* next uid */
        }
      }
    } catch {
      /* no sigs root */
    }
  }
  return null;
}

export async function readSigUploadBuffer(relUnderSigs: string): Promise<Buffer | null> {
  const disk = await readSigUploadFromPublicDisk(relUnderSigs);
  if (disk) return disk;
  const fileOnly = relUnderSigs.split("/").pop();
  if (fileOnly && fileOnly !== relUnderSigs) {
    const byName = await readSigUploadByFileName(fileOnly);
    if (byName) return byName;
  }
  return readSigUploadFromSupabase(relUnderSigs);
}

/** 디스크 업로드 직후 Supabase에도 복제 — EC2 재시작·재배포 후 디스크 유실 시 GET 폴백 */
export async function mirrorSigUploadToSupabase(
  relUnderSigs: string,
  data: Buffer,
  contentType: string
): Promise<boolean> {
  const clean = path.normalize(relUnderSigs).replace(/^(\.\.(\/|\\|$))+/, "");
  if (!clean || clean.startsWith("..")) return false;
  const supabase = createSupabaseAdmin();
  const cfg = getSupabaseStorageConfig();
  if (!supabase || !cfg) return false;
  const storagePath = "sigs/" + clean.replace(/\\/g, "/");
  for (const bucket of cfg.buckets) {
    const { error } = await supabase.storage.from(bucket).upload(storagePath, data, {
      contentType: contentType || "application/octet-stream",
      upsert: true,
    });
    if (!error) return true;
  }
  return false;
}

/**
 * 인벤에 /images/sigs/<timestamp>_<id>.ext 만 저장된 레거시 — 실제 파일은 uploads/sigs/<uid>/ 아래인 경우.
 */
export async function readSigUploadBufferByFileName(fileName: string): Promise<Buffer | null> {
  const safe = path.basename(String(fileName || "").trim());
  if (!isDiskUploadFlatFileName(safe)) return null;
  for (const root of getSigUploadPublicRoots()) {
    const base = path.resolve(root, "uploads", "sigs");
    try {
      const entries = await readdir(base, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        const full = path.join(base, ent.name, safe);
        try {
          return await readFile(full);
        } catch {
          /* try next uid dir */
        }
      }
    } catch {
      /* try next public root */
    }
  }
  return null;
}
