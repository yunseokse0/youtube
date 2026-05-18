import { mimeFromFileName } from "@/lib/sig-legacy-image";
import { readSigUploadFromPublicDisk, safeSigUploadRelativePath } from "@/lib/sig-upload-storage";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: { path?: string[] } },
): Promise<Response> {
  const segments = context.params.path ?? [];
  const rel = safeSigUploadRelativePath(segments);
  if (!rel) {
    return new Response("Bad path", { status: 400 });
  }
  const buf = await readSigUploadFromPublicDisk(rel);
  if (!buf) {
    return new Response("Not found", { status: 404 });
  }
  const fileName = rel.split("/").pop() || rel;
  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type": mimeFromFileName(fileName),
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
    },
  });
}
