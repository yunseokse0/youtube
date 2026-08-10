export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const dbUrl = String(process.env.DATABASE_URL || "").trim();
  if (dbUrl && /^mysql:\/\//i.test(dbUrl)) {
    const { registerMysqlKvBackend } = await import("@/app/api/_shared/upstash");
    const mysqlKv = await import("@/app/api/_shared/mysql-kv");
    registerMysqlKvBackend(mysqlKv);
  }

  const { restoreToonationListenersFromStore } = await import("@/lib/donation/toonation/server-listener");
  await restoreToonationListenersFromStore();
}
