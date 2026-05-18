export type SigGithubTreeCtx = { owner: string; repo: string; ref: string };

type CacheEntry = {
  paths: string[];
  expiresAt: number;
};

const treeCache = new Map<string, CacheEntry>();

function cacheKey(ctx: SigGithubTreeCtx): string {
  return `${ctx.owner}/${ctx.repo}@${ctx.ref}`;
}

/** 기본 1시간. `SIG_BUNDLED_GITHUB_CACHE_MS=0` 이면 캐시 끔 */
export function readSigGithubTreeCacheMs(): number {
  const raw = String(process.env.SIG_BUNDLED_GITHUB_CACHE_MS ?? "3600000").trim();
  const n = parseInt(raw.replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(n)) return 3_600_000;
  return Math.max(0, n);
}

export function readSigGithubTreeCache(ctx: SigGithubTreeCtx): string[] | null {
  const ttl = readSigGithubTreeCacheMs();
  if (ttl <= 0) return null;
  const entry = treeCache.get(cacheKey(ctx));
  if (!entry || Date.now() > entry.expiresAt) return null;
  return entry.paths;
}

export function writeSigGithubTreeCache(ctx: SigGithubTreeCtx, paths: string[]): void {
  const ttl = readSigGithubTreeCacheMs();
  if (ttl <= 0) return;
  treeCache.set(cacheKey(ctx), { paths, expiresAt: Date.now() + ttl });
}
