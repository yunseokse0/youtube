import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import {
  readSigGithubTreeCache,
  writeSigGithubTreeCache,
  type SigGithubTreeCtx,
} from "@/lib/sig-bundled-github-cache";

/**
 * `public/images/sigs` 정적 파일 목록 — 관리자「저장소에서」선택용.
 * 배포 디스크(fs) + (선택) GitHub 트리 API 병합 — GitHub에만 있고 빌드 산출물에 없는 파일도 목록에 포함.
 */
export const runtime = "nodejs";

const MAX_FILES = 600;
const ALLOWED_EXT = new Set([".gif", ".png", ".webp", ".jpg", ".jpeg", ".svg"]);
const SIG_PREFIX = "public/images/sigs/";
/** `getSigRollingGithubRawRoot()` 와 동일 — BASE 미설정 시에도 트리 API가 같은 저장소를 보도록 */
const DEFAULT_SIG_ROLLING_RAW_ROOT = "https://raw.githubusercontent.com/yunseokse0/youtube/main/public";

export type SigBundledImagesMeta = {
  diskCount: number;
  remoteCount: number;
  /** owner/repo/ref 를 알아 트리 요청을 시도했는지 */
  githubTried: boolean;
  /** 시도했으나 HTTP 오류·타임아웃·본문 파싱 실패 */
  githubFetchFailed: boolean;
  /** 트리 요청을 하지 않은 이유(ctx 가 없을 때) */
  githubSkipReason: "list_disabled" | "rolling_disabled" | "unparseable_base" | null;
  githubCacheHit?: boolean;
};

function parseOwnerRepoRefFromRollingRoot(root: string): { owner: string; repo: string; ref: string } | null {
  const b = root.replace(/\/$/, "");
  const mRaw = b.match(/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)(?:\/|$)/i);
  if (mRaw) return { owner: mRaw[1], repo: mRaw[2], ref: mRaw[3] };
  const mJs = b.match(/cdn\.jsdelivr\.net\/gh\/([^/]+)\/([^/@]+)@([^/]+)(?:\/|$)/i);
  if (mJs) return { owner: mJs[1], repo: mJs[2], ref: mJs[3] };
  return null;
}

function parseGithubContextForBundledList(): {
  ctx: { owner: string; repo: string; ref: string } | null;
  skipReason: SigBundledImagesMeta["githubSkipReason"];
} {
  const listOff = process.env.SIG_BUNDLED_GITHUB_LIST?.trim().toLowerCase();
  if (listOff === "0" || listOff === "false" || listOff === "off") {
    return { ctx: null, skipReason: "list_disabled" };
  }

  const explicitRepo = process.env.SIG_BUNDLED_GITHUB_REPO?.trim();
  const explicitRef = process.env.SIG_BUNDLED_GITHUB_REF?.trim() || "main";
  if (explicitRepo && /^[\w.-]+\/[\w.-]+$/.test(explicitRepo)) {
    const [owner, repo] = explicitRepo.split("/");
    if (owner && repo) return { ctx: { owner, repo, ref: explicitRef }, skipReason: null };
  }

  const raw = process.env.NEXT_PUBLIC_SIG_ROLLING_GITHUB_BASE?.trim() ?? "";
  if (raw === "0" || raw.toLowerCase() === "off") {
    return { ctx: null, skipReason: "rolling_disabled" };
  }
  const root = raw ? raw.replace(/\/$/, "") : DEFAULT_SIG_ROLLING_RAW_ROOT;
  const parsed = parseOwnerRepoRefFromRollingRoot(root);
  if (!parsed) return { ctx: null, skipReason: "unparseable_base" };
  return { ctx: parsed, skipReason: null };
}

async function listGithubTreeSigPaths(ctx: SigGithubTreeCtx): Promise<string[] | null> {
  const cached = readSigGithubTreeCache(ctx);
  if (cached) return cached;

  const token =
    process.env.SIG_BUNDLED_GITHUB_TOKEN?.trim() ||
    process.env.GITHUB_TOKEN?.trim() ||
    "";
  const url = `https://api.github.com/repos/${encodeURIComponent(ctx.owner)}/${encodeURIComponent(ctx.repo)}/git/trees/${encodeURIComponent(ctx.ref)}?recursive=1`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 15_000);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: ac.signal,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "User-Agent": "excel-broadcast-sig-bundled-images",
      },
    });
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
  if (!res.ok) return null;
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || !("tree" in data)) return null;
  const tree = (data as { tree?: unknown }).tree;
  if (!Array.isArray(tree)) return null;

  const out: string[] = [];
  for (const item of tree) {
    if (out.length >= MAX_FILES) break;
    if (!item || typeof item !== "object") continue;
    const o = item as { type?: string; path?: string };
    if (o.type !== "blob" || typeof o.path !== "string") continue;
    if (!o.path.startsWith(SIG_PREFIX)) continue;
    const ext = path.extname(o.path).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) continue;
    const rel = o.path.slice("public".length).replace(/\\/g, "/");
    if (!rel || rel.startsWith("..")) continue;
    out.push(rel.startsWith("/") ? rel : `/${rel}`);
  }
  out.sort((a, b) => a.localeCompare(b, "ko"));
  return out;
}

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

function normalizeBundledPathKey(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+/g, "/").toLowerCase();
}

function mergePaths(disk: string[], remote: string[] | null): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  const add = (raw: string) => {
    if (merged.length >= MAX_FILES) return;
    const norm = raw.replace(/\\/g, "/").replace(/\/+/g, "/");
    const key = normalizeBundledPathKey(norm);
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(norm);
  };
  for (const p of disk) add(p);
  for (const p of remote || []) add(p);
  merged.sort((a, b) => a.localeCompare(b, "ko"));
  return merged.slice(0, MAX_FILES);
}

export async function GET() {
  try {
    const disk = listBundledSigImagePaths();
    const { ctx, skipReason } = parseGithubContextForBundledList();
    let remote: string[] | null = null;
    let githubFetchFailed = false;
    let githubCacheHit = false;
    if (ctx) {
      githubCacheHit = readSigGithubTreeCache(ctx) !== null;
      try {
        remote = await listGithubTreeSigPaths(ctx);
        if (remote === null) githubFetchFailed = true;
      } catch {
        remote = null;
        githubFetchFailed = true;
      }
    }
    const paths = mergePaths(disk, remote);
    const meta: SigBundledImagesMeta = {
      diskCount: disk.length,
      remoteCount: remote?.length ?? 0,
      githubTried: Boolean(ctx),
      githubFetchFailed,
      githubSkipReason: ctx ? null : skipReason,
      githubCacheHit,
    };
    return NextResponse.json(
      { ok: true as const, paths, meta },
      { headers: { "Cache-Control": "private, max-age=3600" } }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false as const, error: message, paths: [] }, { status: 500 });
  }
}
