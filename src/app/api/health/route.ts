export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import {
  getPersistentKvLastError,
  isPersistentKvConfigured,
  isRedisConfigured,
  redisKvPing,
} from "@/app/api/_shared/upstash";

const HEALTH_MONITOR_SAMPLE_RATE = Number(process.env.HEALTH_MONITOR_SAMPLE_RATE ?? 0.02);

function tryExtractClientIp(req: Request): string | null {
  const tryFirstList = (val: string | null): string | null => {
    if (!val) return null;
    const first = val.split(",")[0]?.trim();
    return first || null;
  };
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return tryFirstList(xff);
  const xri = req.headers.get("x-real-ip");
  if (xri) return tryFirstList(xri);
  const xfhh = req.headers.get("x-forwarded-host") || "";
  if (xfhh) return `via=${xfhh.split(",")[0]?.trim() || "proxy"}`;
  const fwd = req.headers.get("forwarded");
  if (fwd) {
    const m = fwd.match(/for=([^;,]+)/i);
    if (m && m[1]) return (m[1] as string).replace(/^\[|\]$|"/g, "").trim() || null;
  }
  return null;
}

function writeMonitorLog(line: string) {
  try {
    const LOG_DIR =
      process.env.HEALTH_MONITOR_LOG_DIR ||
      `${process.env.HOME ?? "/tmp"}/.din-studio/health-logs`;
    const { mkdirSync, appendFileSync, existsSync } = require("node:fs") as typeof import("node:fs");
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    const fname = `${LOG_DIR}/health-monitor-${new Date().toISOString().slice(0, 10)}.log`;
    appendFileSync(fname, `[${new Date().toISOString()}] ${line}\n`, { encoding: "utf-8" });
  } catch {
    // 로그 쓰기 실패는 health 자체를 깨뜨리지 않음 — 무시
  }
}

/** Render·모니터·EC2 워치독용 헬스체크 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const deep = url.searchParams.get("deep") === "1";
  const payload: Record<string, unknown> = {
    ok: true,
    ts: Date.now(),
  };

  if (deep) {
    const ua = req.headers.get("user-agent") || "";
    const ip = tryExtractClientIp(req) || "unknown";
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
      const { mysqlKvPing, mysqlKvConnModeFromDatabaseUrl } = await import("@/app/api/_shared/mysql-kv");
      mysqlOk = await mysqlKvPing();
      payload.mysqlOk = mysqlOk;
      payload.mysqlConnMode = mysqlKvConnModeFromDatabaseUrl();
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

    payload.clientIp = ip;
    payload.ua = ua.length > 120 ? ua.slice(0, 120) : ua;

    // 로그 남기는 조건: (a) 외부 모니터링 UA (UptimeRobot / BetterStack 등) 또는
    // (b) ok !== true (장애 시 무조건 남김) 또는
    // (c) HEALTH_MONITOR_SAMPLE_RATE 비율로 샘플링
    const isMonitor = /uptimerobot|betterstack|statuscake|pingdom|monitor|cronitor/i.test(ua);
    const shouldLog =
      !payload.ok || isMonitor || Math.random() < HEALTH_MONITOR_SAMPLE_RATE;
    if (shouldLog) {
      writeMonitorLog(
        `deep=1 ok=${String(payload.ok)} ip=${ip} redisOk=${String(redisOk)} mysqlOk=${String(
          mysqlOk
        )} kvConfigured=${String(kvConfigured)} kvErr=${(kvError || "").toString().slice(0, 60) || "-"} ua=${
          ua.length > 96 ? ua.slice(0, 96) : ua || "-"
        }`
      );
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
