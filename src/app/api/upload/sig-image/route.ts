import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { getUserIdFromRequest } from "@/app/api/_shared/user-id";
import { shouldServeSigImagesFromDisk } from "@/lib/sig-image-mode";
import { getSigUploadPublicRoots, getSupabaseStorageConfig } from "@/lib/sig-upload-storage";
import {
  ftpPublicImageUrlPath,
  ftpRemotePathForSigAsset,
  shouldServeSigImagesFromFtp,
  uploadSigBufferToFtp,
} from "@/lib/ftp-sig-storage";
import { getFtpAccessConfig } from "@/lib/ftp-config";

export const runtime = "nodejs";
export const revalidate = 0;

const MAX_BYTES = 30 * 1024 * 1024;

function isValidUserId(value: string): boolean {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(value);
}

function resolveUploadUserId(req: Request): string | null {
  try {
    const url = new URL(req.url);
    const fromQuery = (url.searchParams.get("user") || url.searchParams.get("u") || "").trim();
    if (fromQuery && isValidUserId(fromQuery)) return fromQuery;
  } catch {}
  const fromHeader = (req.headers.get("x-user-id") || "").trim();
  if (fromHeader && isValidUserId(fromHeader)) return fromHeader;
  const parsed = getUserIdFromRequest(req);
  if (parsed && isValidUserId(parsed)) return parsed;
  return null;
}

function isEphemeralCloudUpload(): boolean {
  if (process.env.NODE_ENV !== "production") return false;
  if (getSupabaseStorageConfig()) return false;
  if (shouldServeSigImagesFromFtp() && getFtpAccessConfig()) return false;
  /** Render 디스크만 비영구. AWS·자체 서버는 로컬 디스크 업로드 허용 */
  return process.env.RENDER === "true";
}

/** Supabase/FTP 없을 때 디스크 저장 허용 여부 */
function shouldUseDiskSigUpload(): boolean {
  if (shouldServeSigImagesFromDisk()) return true;
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.RENDER !== "true";
}

function extFrom(file: File): string | null {
  const t = String(file.type || "").toLowerCase();
  const n = String(file.name || "").toLowerCase();
  if (t.includes("gif")) return ".gif";
  if (t.includes("png")) return ".png";
  if (t.includes("jpeg") || t.includes("jpg")) return ".jpg";
  if (t.includes("webp")) return ".webp";
  if (n.endsWith(".gif")) return ".gif";
  if (n.endsWith(".png")) return ".png";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return ".jpg";
  if (n.endsWith(".webp")) return ".webp";
  return null;
}

function extFromBytes(buf: Uint8Array): string | null {
  if (buf.length >= 6) {
    // GIF87a / GIF89a
    const sig = String.fromCharCode(buf[0] || 0, buf[1] || 0, buf[2] || 0, buf[3] || 0, buf[4] || 0, buf[5] || 0);
    if (sig === "GIF87a" || sig === "GIF89a") return ".gif";
  }
  if (buf.length >= 8) {
    // PNG signature
    if (
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47 &&
      buf[4] === 0x0d &&
      buf[5] === 0x0a &&
      buf[6] === 0x1a &&
      buf[7] === 0x0a
    ) return ".png";
  }
  if (buf.length >= 12) {
    // WEBP: RIFF....WEBP
    if (
      buf[0] === 0x52 &&
      buf[1] === 0x49 &&
      buf[2] === 0x46 &&
      buf[3] === 0x46 &&
      buf[8] === 0x57 &&
      buf[9] === 0x45 &&
      buf[10] === 0x42 &&
      buf[11] === 0x50
    ) return ".webp";
  }
  if (buf.length >= 3) {
    // JPEG signature
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return ".jpg";
  }
  return null;
}

async function writeSigImageToPublicUploads(
  safeUid: string,
  fileName: string,
  data: Buffer
): Promise<string> {
  const storagePath = `sigs/${safeUid}/${fileName}`;
  const roots = getSigUploadPublicRoots();
  for (const root of roots) {
    const dir = path.join(root, "uploads", "sigs", safeUid);
    await mkdir(dir, { recursive: true });
    const fullPath = path.join(dir, fileName);
    await writeFile(fullPath, data);
  }
  return `/uploads/${storagePath}`;
}

export async function POST(req: Request) {
  try {
    const uid = resolveUploadUserId(req);
    if (!uid) {
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return Response.json({ ok: false, error: "missing_file" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return Response.json({ ok: false, error: "file_too_large" }, { status: 413 });
    }
    const ab = await file.arrayBuffer();
    const bytes = new Uint8Array(ab);
    const ext = extFrom(file) || extFromBytes(bytes);
    if (!ext) {
      return Response.json({ ok: false, error: "invalid_type" }, { status: 400 });
    }

    const safeUid = String(uid).replace(/[^a-zA-Z0-9_-]/g, "_") || "user";
    const fileName = `${Date.now()}_${randomUUID().slice(0, 8)}${ext}`;
    const data = Buffer.from(ab);
    const storagePath = `sigs/${safeUid}/${fileName}`;
    const contentType = String(file.type || "application/octet-stream");
    const supabaseConfig = getSupabaseStorageConfig();

    if (shouldUseDiskSigUpload()) {
      const url = await writeSigImageToPublicUploads(safeUid, fileName, data);
      return Response.json(
        { ok: true, url, storage: "disk", ephemeral: isEphemeralCloudUpload() },
        { status: 200 }
      );
    }

    if (shouldServeSigImagesFromFtp() && getFtpAccessConfig()) {
      try {
        const remote = ftpRemotePathForSigAsset(safeUid, fileName);
        await uploadSigBufferToFtp(remote, data);
        return Response.json({ ok: true, url: ftpPublicImageUrlPath(safeUid, fileName) }, { status: 200 });
      } catch {
        /* FTP 실패 시 Supabase·로컬로 폴백 */
      }
    }

    if (supabaseConfig) {
      const supabase = createClient(supabaseConfig.url, supabaseConfig.serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      let uploadedBucket = "";
      let uploadErrorMessage = "unknown";
      for (const bucket of supabaseConfig.buckets) {
        const { error } = await supabase.storage
          .from(bucket)
          .upload(storagePath, data, {
            contentType,
            upsert: false,
          });
        if (!error) {
          uploadedBucket = bucket;
          break;
        }
        uploadErrorMessage = error.message;
      }
      if (!uploadedBucket) {
        return Response.json({ ok: false, error: `supabase_upload_failed:${uploadErrorMessage}` }, { status: 500 });
      }
      const { data: publicData } = supabase.storage
        .from(uploadedBucket)
        .getPublicUrl(storagePath);
      const publicUrl = publicData?.publicUrl || "";
      if (!publicUrl) return Response.json({ ok: false, error: "supabase_public_url_failed" }, { status: 500 });
      return Response.json({ ok: true, url: publicUrl, storage: "supabase" }, { status: 200 });
    }

    if (isEphemeralCloudUpload()) {
      return Response.json(
        {
          ok: false,
          error:
            "supabase_required: Render 등 프로덕션에서는 SUPABASE_URL·SUPABASE_SERVICE_ROLE_KEY·SUPABASE_STORAGE_BUCKET 환경 변수가 필요합니다. (디스크 업로드는 재배포 시 삭제됩니다)",
        },
        { status: 503 }
      );
    }

    const url = await writeSigImageToPublicUploads(safeUid, fileName, data);
    return Response.json({ ok: true, url, storage: "disk", ephemeral: false }, { status: 200 });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
