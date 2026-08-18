export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import {
  ensureMysqlKvBackend,
  getPersistentKvLastError,
  isPersistentKvConfigured,
} from "@/app/api/_shared/upstash";

/** Render·모니터·EC2 워치독용 헬스체크 */
export async function GET(req: Request) {
  const deep = new URL(req.url).searchParams.get("deep") === "1";
  const payload: Record<string, unknown> = {
    ok: true,
    ts: Date.now(),
  };

  if (deep) {
    let mysqlOk = false;
    let kvConfigured = false;
    try {
      kvConfigured = isPersistentKvConfigured();
      if (kvConfigured) {
        await ensureMysqlKvBackend();
        mysqlOk = true;
      }
    } catch {
      mysqlOk = false;
    }
    const kvError = kvConfigured ? await getPersistentKvLastError() : null;
    payload.kvConfigured = kvConfigured;
    payload.mysqlOk = mysqlOk;
    if (kvError) payload.kvError = kvError;
    if (!mysqlOk && kvConfigured) {
      payload.ok = false;
      return Response.json(payload, {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });
    }
  }

  return Response.json(payload, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
