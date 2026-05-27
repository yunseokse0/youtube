import fs from "fs";
import path from "path";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { isLocalSigManagerAllowed } from "@/lib/local-dev-host";
import { localSigFromDriveLookupNames } from "@/lib/local-sig-catalog";

export const dynamic = "force-dynamic";

const FROM_DRIVE = path.join(process.cwd(), "public", "images", "sigs", "from-drive");
const DEFAULT_EC2 = (process.env.SIG_CATALOG_BASE_URL || "http://3.35.3.149").replace(/\/$/, "");

function safeName(name: string): string {
  return path.basename(String(name || "").trim());
}

function findLocalGif(name: string): string | null {
  const raw = safeName(name).replace(/\.[^.]+$/i, "");
  const bases = raw ? localSigFromDriveLookupNames(raw) : [];
  for (const base of bases) {
    for (const ext of [".gif", ".GIF", ".png", ".PNG", ".webp"]) {
      const fp = path.join(FROM_DRIVE, base + ext);
      if (fs.existsSync(fp)) return fp;
    }
  }
  return null;
}

export async function GET(req: Request) {
  const host = headers().get("host") || headers().get("x-forwarded-host") || "";
  if (!isLocalSigManagerAllowed(host)) {
    return new NextResponse("local only", { status: 403 });
  }

  const url = new URL(req.url);
  const name = url.searchParams.get("name") || "";
  const remotePath = url.searchParams.get("path") || "";

  const local = findLocalGif(name || remotePath);
  if (local) {
    const buf = fs.readFileSync(local);
    const ext = path.extname(local).toLowerCase();
    const type =
      ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/gif";
    return new NextResponse(buf, {
      headers: { "Content-Type": type, "Cache-Control": "private, max-age=3600" },
    });
  }

  if (remotePath.startsWith("/")) {
    const base = url.searchParams.get("base") || DEFAULT_EC2;
    try {
      const res = await fetch(`${base.replace(/\/$/, "")}${remotePath}`, {
        headers: { Accept: "image/*" },
      });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        const type = res.headers.get("content-type") || "image/gif";
        return new NextResponse(buf, {
          headers: { "Content-Type": type, "Cache-Control": "private, max-age=300" },
        });
      }
    } catch {
      /* fall through */
    }
  }

  return new NextResponse("not found", { status: 404 });
}
