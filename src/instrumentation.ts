export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const dbUrl = String(process.env.DATABASE_URL || "").trim();
  if (dbUrl && /^mysql:\/\//i.test(dbUrl)) {
    const { registerMysqlKvBackend } = await import("@/app/api/_shared/upstash");
    const mysqlKv = await import("@/app/api/_shared/mysql-kv");
    registerMysqlKvBackend(mysqlKv);
  }

  const { restoreToonationListenersFromStore } = await import("@/lib/donation/toonation/server-listener");
  /** MySQL 지연·hang 시 register 가 끝나지 않아 /api/health 포함 전 HTTP가 무응답 — 비동기·지연 복구 */
  void (async () => {
    await new Promise((r) => setTimeout(r, 12_000));
    await restoreToonationListenersFromStore().catch((err) => {
      console.error("[instrumentation] restoreToonationListenersFromStore failed", err);
    });
  })();
}
