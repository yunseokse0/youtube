import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { getUserIdFromRequest } from "@/app/api/_shared/user-id";

export const runtime = "nodejs";
export const revalidate = 0;

const MAX_BYTES = 30 * 1024 * 1024;

function getUploadRootCandidates(): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, "public"),
    path.join(cwd, ".next", "standalone", "public"),
  ];
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

function getSupabaseStorageConfig():
  | { url: string; serviceRoleKey: string; buckets: string[] }
  | null {
  const url = (process.env.SUPABASE_URL || "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const preferredBucket = (process.env.SUPABASE_STORAGE_BUCKET || "").trim();
  const buckets = [preferredBucket, "image", "images"].filter(Boolean)
    .filter((name, idx, arr) => arr.indexOf(name) === idx);
  if (!url || !serviceRoleKey) return null;
  return { url, serviceRoleKey, buckets };
}

function getImageKitConfig():
  | { privateKey: string; folderPrefix: string }
  | null {
  const privateKey = (process.env.IMAGEKIT_PRIVATE_KEY || "").trim();
  if (!privateKey) return null;
  const folderPrefix = (process.env.IMAGEKIT_FOLDER_PREFIX || "sigs").trim().replace(/^\/+|\/+$/g, "");
  return { privateKey, folderPrefix: folderPrefix || "sigs" };
}

async function uploadToImageKit(data: Buffer, fileName: string, contentType: string, folder: string, privateKey: string): Promise<string> {
  const auth = Buffer.from(`${privateKey}:`).toString("base64");
  const endpoint = "https://upload.imagekit.io/api/v1/files/upload";

  const tryUpload = async (mode: "binary" | "dataUrl"): Promise<string> => {
    const body = new FormData();
    body.set("fileName", fileName);
    if (mode === "binary") {
      body.set("file", new Blob([data], { type: contentType }), fileName);
    } else {
      body.set("file", `data:${contentType};base64,${data.toString("base64")}`);
    }
    body.set("folder", folder);
    body.set("useUniqueFileName", "true");
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
      },
      body,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`imagekit_upload_failed:${res.status}:${txt.slice(0, 400)}`);
    }
    const json = await res.json() as { url?: string };
    const url = String(json?.url || "").trim();
    if (!url) throw new Error("imagekit_upload_failed:no_url");
    return url;
  };

  // 1) 바이너리 업로드 우선 시도
  try {
    return await tryUpload("binary");
  } catch (binaryErr) {
    // 2) 일부 환경에서 바이너리 multipart 실패 시 data URL 방식으로 1회 재시도
    try {
      return await tryUpload("dataUrl");
    } catch (dataErr) {
      throw new Error(`${String(binaryErr)} | fallback:${String(dataErr)}`);
    }
  }
}

export async function POST(req: Request) {
  try {
    const uid = getUserIdFromRequest(req);
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
    const imagekitConfig = getImageKitConfig();
    const supabaseConfig = getSupabaseStorageConfig();

    if (imagekitConfig) {
      const folder = `/${imagekitConfig.folderPrefix}/${safeUid}`;
      const imagekitUrl = await uploadToImageKit(data, fileName, contentType, folder, imagekitConfig.privateKey);
      return Response.json({ ok: true, url: imagekitUrl }, { status: 200 });
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
      return Response.json({ ok: true, url: publicUrl }, { status: 200 });
    }

    if (process.env.NODE_ENV === "production") {
      return Response.json(
        { ok: false, error: "storage_not_configured: set IMAGEKIT_PRIVATE_KEY or SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY" },
        { status: 500 }
      );
    }

    const roots = getUploadRootCandidates();
    for (const root of roots) {
      const dir = path.join(root, "uploads", "sigs", safeUid);
      await mkdir(dir, { recursive: true });
      const fullPath = path.join(dir, fileName);
      await writeFile(fullPath, data);
    }
    const url = `/uploads/${storagePath}`;
    return Response.json({ ok: true, url }, { status: 200 });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
