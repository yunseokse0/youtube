/**
 * 허브는 예전 ingest 실패 문구를 지울 때까지 그대로 돌려준다.
 * 이번 연결보다 앞선 실패는 연결 오류가 아니므로 보여 주지 않는다.
 */
export function ingestErrorVisibleAfterLink(opts: {
  linkedAt?: number | null;
  lastIngestAt?: string | null;
  lastIngestOk?: boolean | null;
  lastIngestError?: string | null;
}): string | null {
  const err = String(opts.lastIngestError || "").trim();
  if (!err) return null;
  if (opts.lastIngestOk === true) return null;
  const at = Date.parse(String(opts.lastIngestAt || ""));
  const linkedAt = Number(opts.linkedAt || 0);
  if (!Number.isFinite(at) || at <= 0) return null;
  if (linkedAt > 0 && at < linkedAt) return null;
  return err;
}
