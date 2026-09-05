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
            let drained = 0, refreshed = false, pulled = 0;
            try { drained = await drainDonationQueueOnServer(uid); } catch (e) {}
            try { await refreshToonaHubStatus(uid); refreshed = true; } catch (e) {}
            try {
              const r = await fetchToonaDonationsSinceLink(uid);
              if (r && typeof r === "object" && "imported" in r) pulled = Number((r as any).imported) || 0;
            } catch (e) {}
            console.info(`[b-mode] init OK user=${uid} drained=${drained} refreshed=${refreshed} pulled=${pulled}`);
          }
          console.info(`[b-mode] Initial one-shot hub sync + queue drain OK users=[${hubUserIds.join(",")}]`);
        })();

        /**
         * 🔥 B-MODE POLLER · SINGLE STAGGERED JOB + FETCH COALESCE (B모드 단순화 P1)
         *  · 통합 전: 3종 독립 setInterval → 동시 fire → saveMutex 3중첩 블록
         *  · 통합 후: 1개 setInterval(30s) + phase counter(0~5) + reentry lock
         *    주기 RELAXED: drain(30s 항상) / refresh+fetch(180s = phase%6===0 동봉)
         *      ↳ refresh 90s 2회 → fetch 직전 1회 180s 단축 (HTTP 66% 감소)
         *      ↳ fetch 전역 DONATION_PULL_MIN_INTERVAL_MS 재진입 가드로 admin 중복 클릭 시 50건 풀스캔 2회 → 1회
         *    실행 순서 직렬: drain → (phase0 일때 refresh→fetch)
         */
        /** @type {Record<string, boolean>} */
        const pollerLock: Record<string, boolean> = {};
        let pollerPhase = 0; // 0 ~ 5 (6 phases = 180s full cycle)
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
                if (pollerPhase % 6 === 0) {
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
          pollerPhase = (pollerPhase + 1) % 6;
        }, 30_000);

        /**
         * 🔥 broadcast_donations 벌크 stale 정리 cron (1시간마다 1회)
         *  · 기존: 매 저장마다 개별 SELECT id + chunk DELETE 3~8초 병목 → add 모드 infinite skip 으로 100% 제거
         *  · 개선: 1시간마다 현재 AppState donors 목록 → pruneStaleBroadcastDonorsForUser 1회
         *    누적 stale row 1시간치를 모아서 한 번에 정리 → DB 쓰기 부하 99% 절감
         */
        setInterval(() => {
          void (async () => {
            const { loadAppStateForUserId } = await import("@/lib/app-state-server-load");
            const { pruneStaleBroadcastDonorsForUser } = await import(
              "@/lib/donation/broadcast-donations-mysql"
            );
            for (const uid of hubUserIds) {
              try {
                const st = await loadAppStateForUserId(uid).catch(() => null);
                const ids = (st?.donors || []).map((d) => String(d.id || "").trim()).filter(Boolean);
                const removed = await pruneStaleBroadcastDonorsForUser(uid, ids);
                if (removed > 0) {
                  console.info(`[b-mode] prune stale broadcast OK user=${uid} removed=${removed}`);
                }
              } catch (e) {
                console.warn(`[b-mode] prune stale fail uid=${uid}`, e instanceof Error ? e.message : e);
              }
            }
          })();
        }, 60 * 60 * 1000); // 1시간
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
