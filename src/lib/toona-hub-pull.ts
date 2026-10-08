/** 허브 목록 1페이지 크기. 대시보드 기본 30과 별개. 폴링은 after 커서로 이어서 전부 가져온다. */
export const TOONA_DONATION_PULL_PAGE_SIZE = 200;
export const TOONA_DONATION_PULL_MAX_PAGES = 25;
export const TOONA_DONATION_PULL_PAST_MS = 60 * 60 * 1000;

export function resolveToonaDonationPullFromMs(input: {
  linkedAt: number;
  intentionalClearAtMs?: number;
  /** 이미 저장한 당겨오기 바닥. 재연결로 linkedAt이 앞으로 가도 이 시각은 유지한다. */
  persistedFloorAt?: number;
}): number {
  const linked = Math.max(0, Number(input.linkedAt) || 0);
  const clear = Math.max(0, Number(input.intentionalClearAtMs) || 0);
  const persisted = Math.max(0, Number(input.persistedFloorAt) || 0);
  const fromLink = linked > 0 ? Math.max(0, linked - TOONA_DONATION_PULL_PAST_MS) : 0;
  let floor = persisted > 0 ? persisted : fromLink;
  if (clear > floor) floor = clear;
  return Math.floor(floor);
}

/** 정산 리셋으로 바닥이 올라가면 커서를 버리고, 같은 바닥이면 이어서 읽는다. */
export function resolveToonaDonationPullAfter(input: {
  fromMs: number;
  savedFromMs?: number;
  savedAfter?: string;
}): string {
  const after = String(input.savedAfter || "").trim();
  if (!after) return "";
  const savedFrom = Math.floor(Math.max(0, Number(input.savedFromMs) || 0));
  if (savedFrom !== Math.floor(Math.max(0, Number(input.fromMs) || 0))) return "";
  return after;
}

export function lastToonaDonationPullId(
  rows: Array<{ id?: string } | null | undefined>
): string {
  if (!Array.isArray(rows)) return "";
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const id = String(rows[i]?.id || "").trim();
    if (id) return id;
  }
  return "";
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
