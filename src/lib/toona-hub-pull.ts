/** 허브 목록 1페이지 크기. 대시보드 기본 30과 별개. 폴링은 after 커서로 이어서 전부 가져온다. */
export const TOONA_DONATION_PULL_PAGE_SIZE = 200;
/** 한 주기 안전망. 짧은 페이지가 나오면 끝이고, 여기까지면 커서를 남기고 다음 주기가 이어 읽는다. */
export const TOONA_DONATION_PULL_MAX_PAGES = 10_000;
export const TOONA_DONATION_PULL_PAST_MS = 0;

export function resolveToonaDonationPullFromMs(_input?: {
  linkedAt?: number;
  intentionalClearAtMs?: number;
  persistedFloorAt?: number;
}): number {
  return 0;
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

/**
 * toona 원장을 오래된 것부터 페이지로 읽는다.
 * persistCursor=false 이면 옛 버그(한 주기 한도 후 처음으로 돌아감)를 재현한다.
 */
export function collectToonaDonationsSequentially(input: {
  ledger: Array<{ id: string }>;
  pageSize?: number;
  maxPagesPerCycle: number;
  persistCursor: boolean;
  startAfter?: string;
}): { ids: string[]; cycles: number; reachedEnd: boolean } {
  const pageSize = Math.max(1, Number(input.pageSize) || TOONA_DONATION_PULL_PAGE_SIZE);
  const ledger = Array.isArray(input.ledger) ? input.ledger : [];
  let after = String(input.startAfter || "").trim();
  const ids: string[] = [];
  let cycles = 0;
  let reachedEnd = false;

  const indexAfter = (id: string): number => {
    if (!id) return 0;
    const i = ledger.findIndex((row) => row.id === id);
    return i < 0 ? 0 : i + 1;
  };

  while (cycles < 10_000) {
    cycles += 1;
    let cycleAfter = after;
    let pages = 0;
    let hitShort = false;
    for (; pages < input.maxPagesPerCycle; pages += 1) {
      const from = indexAfter(cycleAfter);
      const page = ledger.slice(from, from + pageSize);
      if (page.length === 0) {
        hitShort = true;
        break;
      }
      for (const row of page) ids.push(row.id);
      cycleAfter = page[page.length - 1]?.id || cycleAfter;
      if (page.length < pageSize) {
        hitShort = true;
        break;
      }
    }
    after = input.persistCursor ? cycleAfter : "";
    if (hitShort) {
      reachedEnd = true;
      break;
    }
    if (!input.persistCursor) break;
  }

  return { ids, cycles, reachedEnd };
}
