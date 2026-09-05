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
     * 🔥 FIX: 로직 단순화로 인해 B모드 자동 폴링/큐드레인이 통째로 빠져서 후원 진행 안되던 버그 → 아래 setInterval 3종 추가
     */
    const intakeMode = String(process.env.TOONA_INTAKE_MODE || "").trim().toLowerCase();
    const wsDisableRaw = String(process.env.TOONATION_WS_DISABLE || process.env.DISABLE_TOONATION_LISTENER || "").trim().toLowerCase();
    const wsDisabledByEnv = wsDisableRaw === "1" || wsDisableRaw === "true" || wsDisableRaw === "yes";

    const hubUserIds = String(process.env.STATE_WARM_USER_IDS || process.env.HUB_POLL_USER_IDS || "din")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (intakeMode === "din_only" || wsDisabledByEnv) {
      console.info(
        `[instrumentation] B-MODE (din_only) = Skip WS listeners + START hub auto-poller RELAXED for users=[${hubUserIds.join(",")}]`
      );
      /** 🔥🔥🔥 B-MODE AUTO POLLER · RELAXED INTERVALS (부하 50% 감소)
       *    이전 15s/60s/90s → 30s/90s/180s 로 완화
       *    · drain / fetch / status 모두 내부에서 syncMemberTotalsFromDonors (O(N donors) + dedupDonorRows O(N²)) 실행하므로
       *      3종 setInterval 중첩 → Node 이벤트루프 3~8초씩 블록되는 직접원인 → 간격 2배 완화
       */
      if (hubUserIds.length > 0) {
        const { drainDonationQueueOnServer } = await import("@/lib/donation/server-apply-donation");
        const { refreshToonaHubStatus, fetchToonaDonationsSinceLink } = await import("@/lib/toona-hub-client");

        void (async () => {
          for (const uid of hubUserIds) {
            await refreshToonaHubStatus(uid).catch(() => {});
            await fetchToonaDonationsSinceLink(uid).catch(() => {});
            await drainDonationQueueOnServer(uid).catch(() => {});
          }
          console.info(`[b-mode] Initial one-shot hub sync + queue drain OK users=[${hubUserIds.join(",")}]`);
        })();

        /**
         * ① 매 30초: 큐 드레인
         *    MySQL hang으로 loadAppStateForUserId 실패 → enqueueUnmatchedToonationDonation 에 쌓인 후원들 재시도
         *    (내부 syncMemberTotalsFromDonors 153 donors 1회 실행 → 간격 15s→30s 2배 완화)
         */
        setInterval(() => {
          hubUserIds.forEach((uid) => {
            void drainDonationQueueOnServer(uid).catch(() => {});
          });
        }, 30_000);

        /**
         * ② 매 90초: 허브 상태 갱신
         *    refreshToonaHubStatus 내부에 scenario A→B 자동 승격 + baseUrl 자가수복 로직 있음
         *    (admin 페이지 안열어도 scenario=B / PUSH URL 설정 자동 복구)
         *    (내부 contribution formula persist → 60s→90s 1.5배 완화)
         */
        setInterval(() => {
          hubUserIds.forEach((uid) => {
            void refreshToonaHubStatus(uid).catch(() => {});
          });
        }, 90_000);

        /**
         * ③ 매 180초: 후원 PULL 보정
         *    DIN Hub → /api/donations/ingest PUSH가 네트워크/timeout으로 실패시 180초마다 역방향 PULL로 보정
         *    (dual-path 중복은 dedup 로직에서 ON DUPLICATE KEY로 무시되므로 안전)
         *    (내부 handleDinDonationIngest → syncMemberTotalsFromDonors 153 donors 1회 → 90s→180s 2배 완화)
         */
        setInterval(() => {
          hubUserIds.forEach((uid) => {
            void fetchToonaDonationsSinceLink(uid).catch(() => {});
          });
        }, 180_000);
      }
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
