import { mimeFromFileName, readLegacySigFromPublicDisk, safeSigLegacyRelativePath } from "@/lib/sig-legacy-image";
import { isDiskUploadFlatFileName, isSigLegacyImageApiDisabled, shouldServeSigImagesFromDisk } from "@/lib/sig-image-mode";
import { readSigUploadBufferByFileName } from "@/lib/sig-upload-storage";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: { path?: string[] } },
): Promise<Response> {
  if (isSigLegacyImageApiDisabled()) {
    return new Response("Sig legacy image API disabled (SIG_LEGACY_IMAGE_API_DISABLED)", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const segments = context.params.path ?? [];
  const rel = safeSigLegacyRelativePath(segments);
  if (!rel) {
    return new Response("Bad path", { status: 400 });
  }
  const fileName = rel.split("/").pop() || rel;
  const contentType = mimeFromFileName(fileName);

  let buf: Buffer | null = await readLegacySigFromPublicDisk(rel);
  if (!buf && shouldServeSigImagesFromDisk() && isDiskUploadFlatFileName(fileName)) {
    buf = await readSigUploadBufferByFileName(fileName);
  }

  if (!buf) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
    },
  });
}
