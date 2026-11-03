/**
 * toona 원장 ↔ youtube 정산표(donors) 누락 대조 (읽기 전용 — ingest/저장 없음).
 */
import { donationHubIdentity } from "@/domain/dedupe/donation-hub-identity";
import { shouldDiscardIngestEventForReset } from "@/lib/din-ingest-batch-fold";
import {
  buildToonaDonationsPullUrl,
  nextToonaDonationPullAfter,
  TOONA_DONATION_PULL_PAGE_SIZE,
} from "@/lib/toona-hub-pull";
import {
  toonaHubDonationToEvent,
  type ToonaHubDonationApiRow,
} from "@/lib/toona-hub-donation-map";
import {
  toonaHubAuthHeaders,
  TOONA_HUB_S2S_TOKEN,
  isToonaHubUserLoginRequired,
  type ToonaHubSession,
} from "@/lib/toona-hub-session";
import { normalizeToonaApiBaseUrl } from "@/lib/toona-sig-import";

export type ToonaDonationGapSample = {
  id: string;
  bareId: string;
  amount: number;
  donorName: string;
  at: number;
  target?: "account" | "toon";
};

export type ToonaDonationGapResult = {
  ok: true;
  linked: boolean;
  toonaFetched: number;
  matched: number;
  missing: number;
  discardedReset: number;
  skippedInvalid: number;
  fromMs: number;
  pages: number;
  reachedEnd: boolean;
  samples: ToonaDonationGapSample[];
  checkedAt: number;
};

export type ToonaDonationGapFail = {
  ok: false;
  error: string;
  linked?: boolean;
};

const DONATION_FETCH_MS = 20_000;
const DEFAULT_MAX_PAGES = 5;
const DEFAULT_SAMPLE_LIMIT = 20;

export function bareDonationId(raw: string): string {
  return donationHubIdentity(String(raw || "").trim());
}

/** 정산표 donors → bare id 집합 */
export function donorBareIdSet(
  donors: Array<{ id?: string; externalId?: string } | null | undefined> | null | undefined
): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(donors)) return out;
  for (const d of donors) {
    if (!d) continue;
    const a = bareDonationId(String(d.id || ""));
    if (a) out.add(a.toLowerCase());
    const b = bareDonationId(String(d.externalId || ""));
    if (b) out.add(b.toLowerCase());
  }
  return out;
}

export function findMissingToonaRows(input: {
  rows: ToonaHubDonationApiRow[];
  donorIds: Set<string>;
  linkedAt: number;
  settlementResetAt: number;
  intentionalDonationClearAt: number;
  importFromMs: number;
}): {
  matched: number;
  missing: ToonaDonationGapSample[];
  discardedReset: number;
  skippedInvalid: number;
} {
  let matched = 0;
  let discardedReset = 0;
  let skippedInvalid = 0;
  const missing: ToonaDonationGapSample[] = [];

  for (const row of input.rows) {
    const event = toonaHubDonationToEvent(row, input.linkedAt, {
      intentionalClearAtMs: input.intentionalDonationClearAt,
      importFromMs: input.importFromMs,
    });
    if (!event) {
      skippedInvalid += 1;
      continue;
    }
    if (
      shouldDiscardIngestEventForReset(
        event,
        input.settlementResetAt,
        input.intentionalDonationClearAt
      )
    ) {
      discardedReset += 1;
      continue;
    }
    const bare = bareDonationId(event.externalId || event.id).toLowerCase();
    if (!bare) {
      skippedInvalid += 1;
      continue;
    }
    if (input.donorIds.has(bare)) {
      matched += 1;
      continue;
    }
    const at = event.at ? new Date(event.at).getTime() : 0;
    missing.push({
      id: String(event.id || ""),
      bareId: bare,
      amount: Math.max(0, Math.round(Number(event.amount) || 0)),
      donorName: String(event.donorName || ""),
      at: Number.isFinite(at) ? at : 0,
      ...(event.target === "account" || event.target === "toon" ? { target: event.target } : {}),
    });
  }

  return { matched, missing, discardedReset, skippedInvalid };
}

async function fetchToonaDonationPage(
  session: ToonaHubSession,
  baseUrl: string,
  fromMs: number,
  after: string,
  limit: number
): Promise<{ ok: true; rows: ToonaHubDonationApiRow[] } | { ok: false; error: string }> {
  const url = buildToonaDonationsPullUrl({
    baseUrl,
    streamKey: session.streamKey,
    fromMs,
    limit,
    after,
  });
  let res: Response;
  try {
    const sessionHeaders = toonaHubAuthHeaders(session);
    res = await fetch(url, {
      headers: sessionHeaders,
      signal: AbortSignal.timeout(DONATION_FETCH_MS),
    });
    const ingestHeaders = toonaHubAuthHeaders({ token: TOONA_HUB_S2S_TOKEN });
    if (
      !res.ok &&
      isToonaHubUserLoginRequired(res.status) &&
      ingestHeaders.Authorization &&
      ingestHeaders.Authorization !== sessionHeaders.Authorization
    ) {
      res = await fetch(url, {
        headers: ingestHeaders,
        signal: AbortSignal.timeout(DONATION_FETCH_MS),
      });
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "donations_unreachable" };
  }
  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    donations?: ToonaHubDonationApiRow[];
  };
  if (!res.ok) return { ok: false, error: json.error || `HTTP ${res.status}` };
  return { ok: true, rows: Array.isArray(json.donations) ? json.donations : [] };
}

/**
 * toona `/api/donations/:streamKey` 를 읽어 정산표와 대조한다. 반영·저장하지 않는다.
 */
export async function checkToonaDonationGap(input: {
  session: ToonaHubSession | null;
  donors: Array<{ id?: string; externalId?: string } | null | undefined>;
  settlementResetAt?: number;
  intentionalDonationClearAt?: number;
  /** 조회 하한(ms). 기본: max(리셋 floor, now - windowMs) */
  fromMs?: number;
  /** fromMs 미지정 시 now-windowMs 사용 (기본 6시간) */
  windowMs?: number;
  maxPages?: number;
  pageSize?: number;
  sampleLimit?: number;
}): Promise<ToonaDonationGapResult | ToonaDonationGapFail> {
  const session = input.session;
  if (!session || !String(session.streamKey || "").trim()) {
    return { ok: false, error: "not_linked", linked: false };
  }

  const settlementResetAt = Math.max(0, Math.floor(Number(input.settlementResetAt) || 0));
  const intentionalDonationClearAt = Math.max(
    0,
    Math.floor(Number(input.intentionalDonationClearAt) || 0)
  );
  const resetFloor = Math.max(settlementResetAt, intentionalDonationClearAt);
  const windowMs = Math.max(60_000, Math.floor(Number(input.windowMs) || 6 * 60 * 60 * 1000));
  const fromMs =
    typeof input.fromMs === "number" && Number.isFinite(input.fromMs)
      ? Math.max(0, Math.floor(input.fromMs))
      : Math.max(resetFloor, Date.now() - windowMs);

  const maxPages = Math.max(1, Math.min(50, Math.floor(Number(input.maxPages) || DEFAULT_MAX_PAGES)));
  const pageSize = Math.max(
    1,
    Math.min(200, Math.floor(Number(input.pageSize) || TOONA_DONATION_PULL_PAGE_SIZE))
  );
  const sampleLimit = Math.max(
    1,
    Math.min(100, Math.floor(Number(input.sampleLimit) || DEFAULT_SAMPLE_LIMIT))
  );

  const baseUrl =
    normalizeToonaApiBaseUrl(String(session.baseUrl || "").trim()) || String(session.baseUrl || "");
  if (!baseUrl) return { ok: false, error: "hub_base_missing", linked: true };

  const donorIds = donorBareIdSet(input.donors);
  const allRows: ToonaHubDonationApiRow[] = [];
  let after = "";
  let pages = 0;
  let reachedEnd = false;

  for (let page = 0; page < maxPages; page += 1) {
    const fetched = await fetchToonaDonationPage(session, baseUrl, fromMs, after, pageSize);
    if (!fetched.ok) return { ok: false, error: fetched.error, linked: true };
    pages += 1;
    allRows.push(...fetched.rows);
    const next = nextToonaDonationPullAfter(fetched.rows, pageSize);
    if (!next) {
      reachedEnd = true;
      break;
    }
    after = next;
  }

  const compared = findMissingToonaRows({
    rows: allRows,
    donorIds,
    linkedAt: Math.floor(Number(session.linkedAt) || 0),
    settlementResetAt,
    intentionalDonationClearAt,
    importFromMs: fromMs,
  });

  return {
    ok: true,
    linked: true,
    toonaFetched: allRows.length,
    matched: compared.matched,
    missing: compared.missing.length,
    discardedReset: compared.discardedReset,
    skippedInvalid: compared.skippedInvalid,
    fromMs,
    pages,
    reachedEnd,
    samples: compared.missing.slice(0, sampleLimit),
    checkedAt: Date.now(),
  };
}
