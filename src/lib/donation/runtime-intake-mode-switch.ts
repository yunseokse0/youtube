/**
 * Runtime A/B 모드 전환 컨트롤러
 *
 *  사용자가 관리자 헤더 모드 배지를 클릭해 모드를 바꾸면,
 *  서버 재시작 없이 즉시:
 *   - A 모드 → 기존 Hub Poller (B 모드) 끄고 Toonation WS listener 복구
 *   - B 모드 → Toonation WS listener 멈추고 Hub Poller + Queue Drain 즉시 시작
 */

import type { DonationIntakeMode } from "@/policies/donation-intake-mode";

type IntakeModeApplyResult = {
  ok: true;
  mode: DonationIntakeMode;
  steps: Array<{ step: string; ok: boolean; detail?: string }>;
} | {
  ok: false;
  mode: DonationIntakeMode;
  error: string;
  steps: Array<{ step: string; ok: boolean; detail?: string }>;
};

/** 사용자별 poller flag - 이미 띄워져 있을 경우 중복 실행 방지 */
const runtimeBPollerStartedForUsers = new Set<string>();

export async function applyRuntimeDonationIntakeMode(
  userId: string,
  targetMode: DonationIntakeMode
): Promise<IntakeModeApplyResult> {
  const steps: Array<{ step: string; ok: boolean; detail?: string }> = [];

  try {
    if (targetMode === "B") {
      /**
       * B 모드 (DIN 후원 시스템 · DIN 허브 연결)
       *   ① 기존 Toonation WS listener 멈춤 (투네 직접 경로 막음·중복 방지)
       *   ② Hub poller가 이미 동작 안하면 1회 즉시 drain+refresh+fetch 실행
       *   (instrumentation setInterval은 최초 1회 기동된거 유지 · 모든 유저 공통)
       */
      try {
        const { stopToonationServerListener } = await import("@/infra/ws/toonation-listener");
        stopToonationServerListener(userId);
        steps.push({ step: "B모드 · Toonation WS 연결 끊기 (중복 방지)", ok: true });
      } catch (e) {
        steps.push({
          step: "B모드 · Toonation WS 연결 끊기",
          ok: false,
          detail: e instanceof Error ? e.message : String(e),
        });
      }

      /** 1회 immediate queue drain + hub fetch - poller interval 전까지의 빈 구간 메꾸기 */
      if (!runtimeBPollerStartedForUsers.has(userId)) {
        runtimeBPollerStartedForUsers.add(userId);
        try {
          const { drainDonationQueueOnServer } = await import("@/lib/donation/server-apply-donation");
          const drained = await drainDonationQueueOnServer(userId).catch(() => 0);
          steps.push({
            step: "B모드 · 즉시 큐 드레인 1회 실행",
            ok: true,
            detail: `drained=${drained}`,
          });
        } catch (e) {
          steps.push({
            step: "B모드 · 즉시 큐 드레인",
            ok: false,
            detail: e instanceof Error ? e.message : String(e),
          });
        }
        try {
          const { refreshToonaHubStatus, fetchToonaDonationsSinceLink } = await import("@/lib/toona-hub-client");
          await refreshToonaHubStatus(userId).catch(() => {});
          const fetched = await fetchToonaDonationsSinceLink(userId, { ignoreMinInterval: true }).catch(() => null);
          const imported =
            fetched && typeof fetched === "object" && "imported" in fetched
              ? Number((fetched as { imported?: unknown }).imported) || 0
              : 0;
          steps.push({
            step: "B모드 · 즉시 허브 pull 1회 실행 (전환 직후 미반영 후원 자동 긁기)",
            ok: true,
            detail: `imported=${imported}`,
          });
        } catch (e) {
          steps.push({
            step: "B모드 · 즉시 허브 pull",
            ok: false,
            detail: e instanceof Error ? e.message : String(e),
          });
        }
      } else {
        steps.push({
          step: "B모드 · Hub Poller 30s/60s는 이미 instrumentation 기동 상태",
          ok: true,
          detail: "user poller flag 있음 → 중복 skip",
        });
      }
      return { ok: true, mode: "B", steps };
    }

    /**
     * A 모드 (투네이션 자동 · WS 직접 연결)
     *   ① B 모드 poller flag 리셋 (나중에 B로 다시 돌아오면 fresh 1회 실행되게)
     *   ② 유저별 저장된 Toonation 리스너 설정 (alertbox·ownerName) 읽어서
     *      WS listener 복구 → 저장된 config enabled=false 여도 기본적으로 enabled=true 강제로 시작
     */
    runtimeBPollerStartedForUsers.delete(userId);
    steps.push({ step: "A모드 · B Poller flag reset", ok: true });

    try {
      const {
        syncToonationServerListener,
      } = await import("@/infra/ws/toonation-listener");
      const { readToonationListenerConfig } = await import("@/lib/donation/toonation/listener-config-store");
      const saved = await readToonationListenerConfig(userId);
      steps.push({
        step: "A모드 · 저장된 Toonation WS config 읽기",
        ok: true,
        detail: saved
          ? `url=${saved.alertboxUrl ? "있음" : "없음"} · owner=${saved.ownerName ? saved.ownerName : "없음"}`
          : "없음 (관리자 → 오버레이 설정에서 linkKey 등록 필요)",
      });
      if (saved && saved.alertboxUrl) {
        await syncToonationServerListener(
          userId,
          saved.alertboxUrl,
          true,
          saved.ownerName
        );
        steps.push({
          step: "A모드 · Toonation WS listener 자동 복구",
          ok: true,
          detail: "enabled=true 강제 적용",
        });
      } else {
        steps.push({
          step: "A모드 · Toonation WS listener 복구 skip",
          ok: true,
          detail: "아직 alertboxUrl 미등록 → 오버레이 설정에서 linkKey 등록하면 자동 연결",
        });
      }
    } catch (e) {
      steps.push({
        step: "A모드 · Toonation WS 복구 중 오류",
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      });
    }

    return { ok: true, mode: "A", steps };
  } catch (topErr) {
    const error = topErr instanceof Error ? topErr.message : String(topErr);
    return { ok: false, mode: targetMode, error, steps };
  }
}

export function isRuntimeBPollerStartedForUser(userId: string): boolean {
  return runtimeBPollerStartedForUsers.has(userId);
}
