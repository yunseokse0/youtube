import {
  fetchLegacySigFromCdn,
  mimeFromFileName,
  readLegacySigFromPublicDisk,
  safeSigLegacyRelativePath,
} from "@/lib/sig-legacy-image";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: { path?: string[] } },
): Promise<Response> {
  const segments = context.params.path ?? [];
  const rel = safeSigLegacyRelativePath(segments);
  if (!rel) {
    return new Response("Bad path", { status: 400 });
  }
  const fileName = rel.split("/").pop() || rel;
  const contentType = mimeFromFileName(fileName);

  let buf: Buffer | null = await readLegacySigFromPublicDisk(rel);
  if (!buf) buf = await fetchLegacySigFromCdn(rel);

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
