import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { AUTH_COOKIE, isDevAuthBypassRequest } from "@/lib/auth";

export const runtime = "nodejs";
export const revalidate = 0;

const MAX_BYTES = 30 * 1024 * 1024;

function getUserId(req: Request): string | null {
  if (isDevAuthBypassRequest(req)) return "finalent";
  const cookie = req.headers.get("cookie") || "";
  const match = cookie.match(new RegExp(`${AUTH_COOKIE}=([^;]+)`));
  if (!match) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(match[1]));
    return parsed?.id || null;
  } catch {
    return null;
  }
}

function extFrom(file: File): string | null {
  const t = String(file.type || "").toLowerCase();
  if (t.includes("gif")) return ".gif";
  if (t.includes("png")) return ".png";
  if (t.includes("jpeg") || t.includes("jpg")) return ".jpg";
  if (t.includes("webp")) return ".webp";
  return null;
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
    const ext = extFrom(file);
    if (!ext) {
      return Response.json({ ok: false, error: "invalid_type" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return Response.json({ ok: false, error: "file_too_large" }, { status: 413 });
    }

    const safeUid = String(uid).replace(/[^a-zA-Z0-9_-]/g, "_") || "user";
    const fileName = `${Date.now()}_${randomUUID().slice(0, 8)}${ext}`;
    const dir = path.join(process.cwd(), "public", "uploads", "sigs", safeUid);
    await mkdir(dir, { recursive: true });
    const fullPath = path.join(dir, fileName);
    const ab = await file.arrayBuffer();
    await writeFile(fullPath, Buffer.from(ab));
    const url = `/uploads/sigs/${safeUid}/${fileName}`;
    return Response.json({ ok: true, url }, { status: 200 });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
