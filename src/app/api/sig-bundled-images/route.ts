import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";

/** Git에 포함된 `public/images/sigs` 정적 파일 목록 — 관리자에서 `/images/sigs/…` 선택용 */
export const runtime = "nodejs";

const MAX_FILES = 600;
const ALLOWED_EXT = new Set([".gif", ".png", ".webp", ".jpg", ".jpeg", ".svg"]);

function listBundledSigImagePaths(): string[] {
  const cwd = process.cwd();
  const sigRoot = path.resolve(cwd, "public", "images", "sigs");
  const publicRoot = path.resolve(cwd, "public");
  const out: string[] = [];

  const walk = (dir: string) => {
    if (out.length >= MAX_FILES) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (out.length >= MAX_FILES) return;
      const full = path.join(dir, ent.name);
      const resolved = path.resolve(full);
      if (!resolved.startsWith(sigRoot + path.sep) && resolved !== sigRoot) continue;
      if (ent.isDirectory()) {
        walk(resolved);
      } else {
        const ext = path.extname(ent.name).toLowerCase();
        if (!ALLOWED_EXT.has(ext)) continue;
        const rel = path.relative(publicRoot, resolved).replace(/\\/g, "/");
        if (!rel || rel.startsWith("..")) continue;
        out.push(`/${rel}`);
      }
    }
  };

  try {
    if (fs.existsSync(sigRoot)) walk(sigRoot);
  } catch {
    return [];
  }
  out.sort((a, b) => a.localeCompare(b, "ko"));
  return out;
}

export async function GET() {
  try {
    const paths = listBundledSigImagePaths();
    return NextResponse.json(
      { ok: true as const, paths },
      { headers: { "Cache-Control": "private, max-age=30" } }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false as const, error: message, paths: [] }, { status: 500 });
  }
}
