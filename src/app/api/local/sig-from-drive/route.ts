import fs from "fs";
import path from "path";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { isLocalSigManagerAllowed } from "@/lib/local-dev-host";

export const dynamic = "force-dynamic";

const FROM_DRIVE = path.join(process.cwd(), "public", "images", "sigs", "from-drive");
const ALLOWED = /\.(gif|png|webp|jpe?g)$/i;

export async function GET() {
  const host = headers().get("host") || headers().get("x-forwarded-host") || "";
  if (!isLocalSigManagerAllowed(host)) {
    return NextResponse.json({ ok: false as const, error: "local only" }, { status: 403 });
  }

  let names: string[] = [];
  try {
    names = fs.readdirSync(FROM_DRIVE);
  } catch {
    return NextResponse.json({
      ok: true as const,
      files: [] as string[],
      path: "public/images/sigs/from-drive",
      missingDir: true,
    });
  }

  const files = names
    .filter((n) => ALLOWED.test(n))
    .filter((n) => {
      try {
        return fs.statSync(path.join(FROM_DRIVE, n)).isFile();
      } catch {
        return false;
      }
    })
    .sort((a, b) => a.localeCompare(b, "ko"));

  return NextResponse.json({
    ok: true as const,
    files,
    count: files.length,
    path: "public/images/sigs/from-drive",
  });
}
