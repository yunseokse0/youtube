import { getUserIdFromRequest } from "@/app/api/_shared/user-id";

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

async function listImageKitFiles(
  auth: string,
  limit: number,
  path?: string,
): Promise<ImageKitListItem[]> {
  const q = new URLSearchParams({
    skip: "0",
    limit: String(limit),
    searchQuery: 'type = "file"',
  });
  if (path) q.set("path", path);
  const res = await fetch(`https://api.imagekit.io/v1/files?${q.toString()}`, {
    headers: { Authorization: `Basic ${auth}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`imagekit_list_failed:${res.status}:${txt.slice(0, 300)}`);
  }
  const data = (await res.json()) as ImageKitListItem[];
  return Array.isArray(data) ? data : [];
}

export async function GET(req: Request) {
  try {
    const uid = getUserIdFromRequest(req);
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
    let data = await listImageKitFiles(auth, limit, path);
    // 폴더에 파일이 없으면 전체 라이브러리에서도 조회해 선택 UI가 비어 보이지 않게 보강
    if (!data.length) {
      data = await listImageKitFiles(auth, limit);
    }
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

