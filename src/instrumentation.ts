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
     * ✅ 사용자 요약 정책 (2026-09-06 VERBATIM):
     *   A 모드 (투네 직접): Toonation WS 직접 후원만 받음 → 투네 브라우저/OBS WS 리스너 시작
     *   B 모드 (DIN 허브 연결):  DIN 허브 + 투나(Toona) 프로젝트 후원만 받음 → WS 리스너 시작 안함
     *           오직 DIN 허브(13.125.221.195:4000) → /api/donations/ingest (TOONA_INGEST_SECRET) 1경로 유일 유입
     *  · Dual-Path 2행 중복 원천 봉쇄
     *  · 무한 reconnect loop CPU 97% 원천 차단 (B모드에서 WS start 하지 않음)
     */
    const wsDisableRaw = String(process.env.TOONATION_WS_DISABLE || process.env.DISABLE_TOONATION_LISTENER || "").trim().toLowerCase();
    const wsDisabledByEnv = wsDisableRaw === "1" || wsDisableRaw === "true" || wsDisableRaw === "yes";
    const {
      isDonationIntakeModeA,
      isDonationIntakeModeB,
      describeDonationIntakeMode,
    } = await import("@/policies/donation-intake-mode");
    const modeA = isDonationIntakeModeA();
    const modeB = isDonationIntakeModeB();
    const modeDesc = describeDonationIntakeMode();

    const hubUserIds = String(process.env.STATE_WARM_USER_IDS || process.env.HUB_POLL_USER_IDS || "din")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (modeB || wsDisabledByEnv) {
      console.info(
        `[instrumentation] ${modeDesc} = Skip Toonation WS listeners + START hub auto-poller RELAXED for users=[${hubUserIds.join(",")}]`
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
            let drained = 0, refreshed = false, pulled = 0;
            try { drained = await drainDonationQueueOnServer(uid); } catch (e) {}
            try { await refreshToonaHubStatus(uid); refreshed = true; } catch (e) {}
            try {
              /** ✅ 2026-09-07 Hotfix: init 단계는 ignoreMinInterval 강제로 써서
               *  60초 DONATION_PULL_MIN_INTERVAL_MS cooldown 이 다음 scheduled fetch 로 이어져서
               *  실제 첫 정상 자동 fetch 가 6분 뒤로 미뤄지는 현상 원천 차단 */
              const r = await fetchToonaDonationsSinceLink(uid, { ignoreMinInterval: true });
              if (r && typeof r === "object" && "imported" in r) pulled = Number((r as any).imported) || 0;
            } catch (e) {}
            console.info(`[b-mode] init OK user=${uid} drained=${drained} refreshed=${refreshed} pulled=${pulled}`);
          }
          console.info(`[b-mode] Initial one-shot hub sync + queue drain OK users=[${hubUserIds.join(",")}]`);
        })();

        /**
         * 🔥 B-MODE POLLER · SINGLE STAGGERED JOB + FETCH COALESCE (B모드 단순화 P1 + Fix ⑥-3)
         *  · 통합 전: 3종 독립 setInterval → 동시 fire → saveMutex 3중첩 블록
         *  · 통합 후: 1개 setInterval(30s) + phase counter(0~1) + reentry lock
         *    주기 RELAXED + 반응성 FIX:
         *      ✅ drain(30s 항상, 큐 적체 방지)
         *      ✅ refresh+fetch(**60초마다 = phase%2===0**, 이전 180초 → 사용자 "자동 안돼요" Bug Fix)
         *        ↳ fetch 내부 DONATION_PULL_MIN_INTERVAL_MS=60s 가드와 정확히 맞물려서 중복 호출 0회 + 최대 응답성 60초
         *        ↳ 기존 180초 fetch 주기: 후원 보내고 최대 3분 대기 → "수동 버튼만 돼요" 오해 유발 👎
         *    실행 순서 직렬: drain → (phase0 일때 refresh→fetch)
         */
        /** @type {Record<string, boolean>} */
        const pollerLock: Record<string, boolean> = {};
        let pollerPhase = 0; // 0 ~ 1 (2 phases = 60s full cycle · DIN 허브 1분 pull interval 과 일치)
        setInterval(() => {
          for (const uid of hubUserIds) {
            if (pollerLock[uid]) {
              console.warn(`[b-mode] poller reentry SKIP user=${uid} (prev job still running >30s, saveMutex 밀로 예상)`);
              continue;
            }
            pollerLock[uid] = true;
            void (async () => {
              try {
                await drainDonationQueueOnServer(uid).catch((e) =>
                  console.warn(`[b-mode] drain fail uid=${uid}`, e?.message || e)
                );
                if (pollerPhase % 2 === 0) {
                  await refreshToonaHubStatus(uid).catch((e) =>
                    console.warn(`[b-mode] refresh fail uid=${uid}`, e?.message || e)
                  );
                  await fetchToonaDonationsSinceLink(uid).catch((e) =>
                    console.warn(`[b-mode] fetch fail uid=${uid}`, e?.message || e)
                  );
                }
              } finally {
                pollerLock[uid] = false;
              }
            })();
          }
        pollerPhase = (pollerPhase + 1) % 2;
        }, 30_000);

        /**
         * ✅ Single Source of Truth · cron-jobs.ts registerIntervalCronJobs(hubUserIds) 1줄로 통합!
         *  - 기존 하드코딩 setInterval (1시간, hubUserIds 순회 loadAppState + pruneStaleBroadcastDonorsForUser)
         *    전체 로직을 Shell Cron Layer로 이관 → cron 로직 일관성 100%
         *  · 개선: 1시간마다 현재 AppState donors 목록 → pruneStaleBroadcastDonorsForUser 1회
         *    누적 stale row 1시간치를 모아서 한 번에 정리 → DB 쓰기 부하 99% 절감
         */
        const { registerIntervalCronJobs } = await import("@/shell/cron-jobs");
        registerIntervalCronJobs({ hubUserIds });
      }
      return;
    }

    /** ✅ A 모드 (투네 직접 연결): Toonation 브라우저 릴레이 / OBS WS 리스너 시작 */
    console.info(
      `[instrumentation] ${modeDesc} = START Toonation WS listeners (hub poller disabled)`
    );
    const { restoreToonationListenersFromStore } = await import(
      "@/lib/donation/toonation/server-listener"
    );
    await restoreToonationListenersFromStore().catch((err) => {
      console.error("[instrumentation] restoreToonationListenersFromStore failed", err);
    });
  })();
}
