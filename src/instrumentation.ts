export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const dbUrl = String(process.env.DATABASE_URL || "").trim();
  const { isRedisConfigured } = await import("@/app/api/_shared/upstash");
  /** Upstash 설정 시 MySQL pool 선기동 금지 — GET miss마다 TCP ETIMEDOUT 유발 */
  if (dbUrl && /^mysql:\/\//i.test(dbUrl) && !isRedisConfigured()) {
    const { registerMysqlKvBackend } = await import("@/app/api/_shared/upstash");
    const mysqlKv = await import("@/app/api/_shared/mysql-kv");
    registerMysqlKvBackend(mysqlKv);
  }

  /** server-listener import·투네 복구는 HTTP 기동 후 지연 — register 블로킹 방지 */
  void (async () => {
    await new Promise((r) => setTimeout(r, 12_000));
    const { restoreToonationListenersFromStore } = await import(
      "@/lib/donation/toonation/server-listener"
    );
    await restoreToonationListenersFromStore().catch((err) => {
      console.error("[instrumentation] restoreToonationListenersFromStore failed", err);
    });
  })();
}
