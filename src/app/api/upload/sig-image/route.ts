import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { AUTH_COOKIE, isDevAuthBypassRequest } from "@/lib/auth";

export const runtime = "nodejs";
export const revalidate = 0;

const MAX_BYTES = 30 * 1024 * 1024;

function decodeRepeated(value: string, maxDepth = 4): string {
  let out = value;
  for (let i = 0; i < maxDepth; i += 1) {
    try {
      const next = decodeURIComponent(out);
      if (next === out) break;
      out = next;
    } catch {
      break;
    }
  }
  return out;
}

function isValidUserId(value: string): boolean {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(value);
}

function getUploadRootCandidates(): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, "public"),
    path.join(cwd, ".next", "standalone", "public"),
  ];
}

function tryParseUserCookie(raw: string): { id?: string } | null {
  if (!raw) return null;
  const decoded = decodeRepeated(raw);
  const candidates = [raw, decodeURIComponent(raw), decoded];
  for (const cand of candidates) {
    const trimmed = String(cand).trim().replace(/^"|"$/g, "");
    if (!trimmed) continue;
    const deeplyDecoded = decodeRepeated(trimmed);
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") return parsed as { id?: string };
    } catch {}
    try {
      const parsed = JSON.parse(deeplyDecoded);
      if (parsed && typeof parsed === "object") return parsed as { id?: string };
    } catch {}
    // 하위 호환: 쿠키 값이 JSON이 아니라 user id 문자열 자체인 경우
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[") && isValidUserId(trimmed)) {
      return { id: trimmed };
    }
    if (!deeplyDecoded.startsWith("{") && !deeplyDecoded.startsWith("[") && isValidUserId(deeplyDecoded)) {
      return { id: deeplyDecoded };
    }
  }
  return null;
}

function getUserId(req: Request): string | null {
  if (isDevAuthBypassRequest(req)) return "finalent";
  const cookie = req.headers.get("cookie") || "";
  const escaped = AUTH_COOKIE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = cookie.match(new RegExp(`${escaped}=([^;]+)`));
  if (!match) return null;
  const parsed = tryParseUserCookie(match[1] || "");
  const uid = typeof parsed?.id === "string" ? parsed.id.trim() : "";
  if (uid && !isValidUserId(uid)) return null;
  return uid || null;
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

export async function POST(req: Request) {
  try {
    const uid = getUserId(req);
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
    const supabaseConfig = getSupabaseStorageConfig();

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
            contentType: String(file.type || "application/octet-stream"),
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
        { ok: false, error: "storage_not_configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY" },
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
