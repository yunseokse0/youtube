export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const dbUrl = String(process.env.DATABASE_URL || "").trim();
  const { isRedisConfigured } = await import("@/app/api/_shared/upstash");
  /** Upstash 설정 시 MySQL pool 선기동 금지 — GET miss마다 TCP ETIMEDOUT 유발 */
  if (dbUrl && /^mysql:\/\//i.test(dbUrl) && !isRedisConfigured()) {
    const { registerMysqlKvBackend } = await import("@/app/api/_shared/upstash");
    const mysqlKv = await import("@/app/api/_shared/mysql-kv");
    registerMysqlKvBackend(mysqlKv);
    void mysqlKv.mysqlKvPing().then((ok) => {
      if (ok) console.info("[mysql-kv] warm ping OK");
    });
  }

  /**
   * admin/OBS 첫 GET 이 cold MySQL LONGTEXT(최대 ~25s)에 걸리지 않게
   * 핫 유저 상태를 메모리·KV 캐시에 미리 올린다.
   */
  void (async () => {
    await new Promise((r) => setTimeout(r, 1_500));
    const ids = String(process.env.STATE_WARM_USER_IDS || "din")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!ids.length) return;
    try {
      const { loadAppStateForUserId, seedAppStateKvCache } = await import(
        "@/lib/app-state-server-load"
      );
      for (const id of ids) {
        const st = await loadAppStateForUserId(id).catch(() => null);
        if (st && Array.isArray(st.members)) {
          seedAppStateKvCache(id, st);
          console.info(`[state] warm cache OK user=${id} members=${st.members.length}`);
        }
      }
    } catch (err) {
      console.error("[instrumentation] state warm failed", err);
    }
  })();

  /** server-listener import·투네 복구는 HTTP 기동 후 지연 — register 블로킹 방지 */
  void (async () => {
    await new Promise((r) => setTimeout(r, 12_000));

    /**
     * B·DIN 허브 모드 (din_only) 일땐 ↓ 투네 직접 WS 리스너를 아예 시작하지 않음.
     * (1. Dual-Path 2행 중복 원천 봉쇄 + 2. 무한 reconnect loop CPU 97% 방지)
     * — 오직 DIN 허브(13.125.221.195:4000) → /api/donations/ingest (TOONA_INGEST_SECRET) 1경로만 유일 유입
     */
    const intakeMode = String(process.env.TOONA_INTAKE_MODE || "").trim().toLowerCase();
    const wsDisableRaw = String(process.env.TOONATION_WS_DISABLE || process.env.DISABLE_TOONATION_LISTENER || "").trim().toLowerCase();
    const wsDisabledByEnv = wsDisableRaw === "1" || wsDisableRaw === "true" || wsDisableRaw === "yes";
    if (intakeMode === "din_only" || wsDisabledByEnv) {
      console.info(
        `[instrumentation] Skip toonation server listeners (mode=${intakeMode || "default"}, wsDisabled=${wsDisabledByEnv})`
      );
      return;
    }

    const { restoreToonationListenersFromStore } = await import(
      "@/lib/donation/toonation/server-listener"
    );
    await restoreToonationListenersFromStore().catch((err) => {
      console.error("[instrumentation] restoreToonationListenersFromStore failed", err);
    });
  })();
}
