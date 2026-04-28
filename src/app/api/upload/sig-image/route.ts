import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { AUTH_COOKIE, isDevAuthBypassRequest } from "@/lib/auth";

export const runtime = "nodejs";
export const revalidate = 0;

const MAX_BYTES = 30 * 1024 * 1024;

function tryParseUserCookie(raw: string): { id?: string } | null {
  if (!raw) return null;
  const candidates = [raw, decodeURIComponent(raw)];
  for (const cand of candidates) {
    const trimmed = String(cand).trim().replace(/^"|"$/g, "");
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") return parsed as { id?: string };
    } catch {}
    try {
      const decodedTwice = decodeURIComponent(trimmed);
      const parsed = JSON.parse(decodedTwice);
      if (parsed && typeof parsed === "object") return parsed as { id?: string };
    } catch {}
    // 하위 호환: 쿠키 값이 JSON이 아니라 user id 문자열 자체인 경우
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      return { id: trimmed };
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
    const dir = path.join(process.cwd(), "public", "uploads", "sigs", safeUid);
    await mkdir(dir, { recursive: true });
    const fullPath = path.join(dir, fileName);
    await writeFile(fullPath, Buffer.from(ab));
    const url = `/uploads/sigs/${safeUid}/${fileName}`;
    return Response.json({ ok: true, url }, { status: 200 });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
