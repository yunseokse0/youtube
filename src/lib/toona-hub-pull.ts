/** 허브 목록 1페이지 크기. 대시보드 기본 30과 별개. 폴링은 after 커서로 이어서 전부 가져온다. */
export const TOONA_DONATION_PULL_PAGE_SIZE = 200;
export const TOONA_DONATION_PULL_MAX_PAGES = 25;
export const TOONA_DONATION_PULL_PAST_MS = 60 * 60 * 1000;

export function resolveToonaDonationPullFromMs(input: {
  linkedAt: number;
  intentionalClearAtMs?: number;
}): number {
  const linked = Math.max(0, Number(input.linkedAt) || 0);
  const clear = Math.max(0, Number(input.intentionalClearAtMs) || 0);
  const fromLink = linked > 0 ? Math.max(0, linked - TOONA_DONATION_PULL_PAST_MS) : 0;
  return Math.max(fromLink, clear);
}

export function buildToonaDonationsPullUrl(input: {
  baseUrl: string;
  streamKey: string;
  fromMs: number;
  limit?: number;
  after?: string;
}): string {
  const base = String(input.baseUrl || "").replace(/\/$/, "");
  const params = new URLSearchParams({
    sort: "asc",
    limit: String(input.limit ?? TOONA_DONATION_PULL_PAGE_SIZE),
  });
  if (input.fromMs > 0) params.set("fromMs", String(Math.floor(input.fromMs)));
  const after = String(input.after || "").trim();
  if (after) params.set("after", after);
  return `${base}/api/donations/${encodeURIComponent(input.streamKey)}?${params}`;
}

export function nextToonaDonationPullAfter(
  rows: Array<{ id?: string } | null | undefined>,
  pageSize: number
): string | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  if (rows.length < pageSize) return null;
  const last = String(rows[rows.length - 1]?.id || "").trim();
  return last || null;
}
