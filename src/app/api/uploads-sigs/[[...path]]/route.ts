import { mimeFromFileName } from "@/lib/sig-legacy-image";
import {
  readSigUploadBuffer,
  readSigUploadByFileName,
  safeSigUploadRelativePath,
} from "@/lib/sig-upload-storage";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: { path?: string[] } },
): Promise<Response> {
  const segments = context.params.path ?? [];
  const rel = safeSigUploadRelativePath(segments);
  let buf: Buffer | null = null;
  let fileName = "";
  if (rel) {
    buf = await readSigUploadBuffer(rel);
    fileName = rel.split("/").pop() || rel;
  } else if (segments.length === 1) {
    fileName = String(segments[0] || "").trim();
    if (!fileName || fileName.includes("..")) {
      return new Response("Bad path", { status: 400 });
    }
    buf = await readSigUploadByFileName(fileName);
  } else {
    return new Response("Bad path", { status: 400 });
  }
  if (!buf) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type": mimeFromFileName(fileName),
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
    },
  });
}
