import { AUTH_COOKIE, isDevAuthBypassRequest } from "@/lib/auth";

export const runtime = "nodejs";
export const revalidate = 0;

type ImageKitListItem = {
  fileId?: string;
  name?: string;
  url?: string;
  thumbnail?: string;
  thumbnailUrl?: string;
  fileType?: string;
  type?: string;
};

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

function getUserId(req: Request): string | null {
  if (isDevAuthBypassRequest(req)) return "finalent";
  const cookie = req.headers.get("cookie") || "";
  const escaped = AUTH_COOKIE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = cookie.match(new RegExp(`${escaped}=([^;]+)`));
  if (!match?.[1]) return null;
  const candidates = [match[1], decodeRepeated(match[1])];
  for (const cand of candidates) {
    const trimmed = String(cand || "").trim().replace(/^"|"$/g, "");
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as { id?: unknown };
      const uid = typeof parsed?.id === "string" ? parsed.id.trim() : "";
      if (uid && isValidUserId(uid)) return uid;
    } catch {}
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[") && isValidUserId(trimmed)) {
      return trimmed;
    }
  }
  return null;
}

export async function GET(req: Request) {
  try {
    const uid = getUserId(req);
    if (!uid) {
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    const privateKey = (process.env.IMAGEKIT_PRIVATE_KEY || "").trim();
    if (!privateKey) {
      return Response.json({ ok: false, error: "imagekit_not_configured" }, { status: 500 });
    }
    const folderPrefix = (process.env.IMAGEKIT_FOLDER_PREFIX || "sigs").trim().replace(/^\/+|\/+$/g, "") || "sigs";
    const limit = Math.max(10, Math.min(500, Number(new URL(req.url).searchParams.get("limit") || 200)));
    const path = `/${folderPrefix}/${uid}`;
    const auth = Buffer.from(`${privateKey}:`).toString("base64");
    const q = new URLSearchParams({
      path,
      skip: "0",
      limit: String(limit),
      searchQuery: 'type = "file"',
    });
    const res = await fetch(`https://api.imagekit.io/v1/files?${q.toString()}`, {
      headers: { Authorization: `Basic ${auth}` },
      cache: "no-store",
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return Response.json({ ok: false, error: `imagekit_list_failed:${res.status}:${txt.slice(0, 300)}` }, { status: 500 });
    }
    const data = (await res.json()) as ImageKitListItem[];
    const files = (Array.isArray(data) ? data : [])
      .filter((x) => (x.type || x.fileType || "").toLowerCase() === "file")
      .map((x) => ({
        fileId: String(x.fileId || ""),
        name: String(x.name || ""),
        url: String(x.url || ""),
        thumbnailUrl: String(x.thumbnailUrl || x.thumbnail || x.url || ""),
      }))
      .filter((x) => x.url);
    return Response.json({ ok: true, files }, { status: 200 });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

