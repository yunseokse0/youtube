import { ftpRemotePathForSigAsset, downloadSigBufferFromFtp } from "@/lib/ftp-sig-storage";
import { getFtpAccessConfig } from "@/lib/ftp-config";
import { mimeFromFileName } from "@/lib/sig-legacy-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseFtpSigImageSegments(path: string[] | undefined): { safeUid: string; fileName: string } | null {
  const segs = path ?? [];
  if (segs.length !== 3 || segs[0] !== "sigs") return null;
  let safeUid: string;
  let fileName: string;
  try {
    safeUid = decodeURIComponent(segs[1]);
    fileName = decodeURIComponent(segs[2]);
  } catch {
    return null;
  }
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(safeUid)) return null;
  if (!/^[\w.-]{1,240}$/.test(fileName) || fileName.includes("..")) return null;
  if (!/\.(gif|png|jpe?g|webp)$/i.test(fileName)) return null;
  return { safeUid, fileName };
}

export async function GET(
  _request: Request,
  context: { params: { path?: string[] } },
): Promise<Response> {
  if (!getFtpAccessConfig()) {
    return new Response("FTP not configured", { status: 503 });
  }
  const parsed = parseFtpSigImageSegments(context.params.path);
  if (!parsed) {
    return new Response("Bad path", { status: 400 });
  }
  const remotePath = ftpRemotePathForSigAsset(parsed.safeUid, parsed.fileName);
  const buf = await downloadSigBufferFromFtp(remotePath);
  if (!buf || buf.length === 0) {
    return new Response("Not found", { status: 404 });
  }
  const contentType = mimeFromFileName(parsed.fileName);
  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=604800, s-maxage=86400",
    },
  });
}
