export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import {
  getPersistentKvLastError,
  isPersistentKvConfigured,
  isRedisConfigured,
  redisKvPing,
} from "@/app/api/_shared/upstash";

/** Render·모니터·EC2 워치독용 헬스체크 */
export async function GET(req: Request) {
  const deep = new URL(req.url).searchParams.get("deep") === "1";
  const payload: Record<string, unknown> = {
    ok: true,
    ts: Date.now(),
  };

  if (deep) {
    const kvConfigured = isPersistentKvConfigured();
    const redisConfigured = isRedisConfigured();
    payload.kvConfigured = kvConfigured;
    payload.redisConfigured = redisConfigured;

    let redisOk: boolean | null = null;
    let mysqlOk: boolean | null = null;

    if (redisConfigured) {
      redisOk = await redisKvPing();
      payload.redisOk = redisOk;
    }

    const hasMysql = Boolean(
      String(process.env.DATABASE_URL || "")
        .trim()
        .match(/^mysql:\/\//i)
    );
    if (hasMysql) {
      const { mysqlKvPing } = await import("@/app/api/_shared/mysql-kv");
      mysqlOk = await mysqlKvPing();
      payload.mysqlOk = mysqlOk;
    }

    const kvError = await getPersistentKvLastError();
    if (kvError) payload.kvError = kvError;

    /** Redis가 주 저장소면 Redis만 필수 — MySQL TCP 장애로 503 내지 않음 */
    if (redisConfigured) {
      payload.ok = redisOk === true;
    } else if (hasMysql) {
      payload.ok = mysqlOk === true;
    } else {
      payload.ok = kvConfigured;
    }

    if (!payload.ok) {
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
