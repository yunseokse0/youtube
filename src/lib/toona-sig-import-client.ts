import type { SigImportSummary } from "./toona-hub-session";

export type { SigImportSummary };

export type SigImportPollResult = {
  ok: boolean;
  summary?: SigImportSummary;
  currentSigCount?: number;
  error?: string;
};

/**
 * toona 허브에서 시그 목록을 가져오도록 요청하고,
 * 백그라운드 완료될 때까지 상태를 폴링하여 최종 결과와 갯수 현황을 반환합니다.
 */
export async function triggerAndPollSigImport(
  onProgress?: (stageText: string) => void
): Promise<SigImportPollResult> {
  const startAt = Date.now();
  onProgress?.("시그 가져오기 요청 중…");

  let res: Response;
  try {
    res = await fetch("/api/toona/hub", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "import-signatures" }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    const isTimeout =
      err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return {
      ok: false,
      error: isTimeout ? "요청 시간 초과 (30초)" : "네트워크 오류",
    };
  }

  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    deferred?: boolean;
    count?: number;
    added?: number;
    updated?: number;
    totalCount?: number;
  };

  if (!res.ok || data.ok === false) {
    return { ok: false, error: data.error || `서버 오류 (HTTP ${res.status})` };
  }

  // 동기적으로 바로 완료된 경우 (deferred가 아닌 경우)
  if (!data.deferred && typeof data.count === "number") {
    const summary: SigImportSummary = {
      at: Date.now(),
      status: "completed",
      fetchedCount: data.count,
      addedCount: data.added ?? 0,
      updatedCount: data.updated ?? 0,
      totalCount: data.totalCount ?? 0,
    };
    return { ok: true, summary, currentSigCount: data.totalCount };
  }

  // deferred 인 경우 백그라운드 완료 폴링 (최대 20회, 약 24초)
  onProgress?.("toona에서 시그 목록 조회 및 엑셀 방송 시스템에 병합 중…");

  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1200));

    try {
      const pollRes = await fetch("/api/toona/hub", { credentials: "include" });
      if (!pollRes.ok) continue;

      const pollData = (await pollRes.json().catch(() => ({}))) as {
        ok?: boolean;
        session?: { lastSigImport?: SigImportSummary | null } | null;
        currentSigCount?: number;
      };

      if (pollData?.ok && pollData?.session?.lastSigImport) {
        const imp = pollData.session.lastSigImport;
        // 이번 요청 시각 이후에 갱신된 요약인지 확인
        if (imp.at >= startAt - 1500) {
          if (imp.status === "completed") {
            return {
              ok: true,
              summary: imp,
              currentSigCount: pollData.currentSigCount ?? imp.totalCount,
            };
          }
          if (imp.status === "failed") {
            return {
              ok: false,
              summary: imp,
              currentSigCount: pollData.currentSigCount,
              error: imp.error || "시그 가져오기 실패",
            };
          }
        }
      }
    } catch {
      // 일시적 오류 시 다음 틱 재시도
    }
  }

  return {
    ok: false,
    error: "시그 가져오기가 백그라운드에서 진행 중입니다. 잠시 후 새로고침해 주세요.",
  };
}

/**
 * 시그 가져오기 결과를 사용자 친화적 문구로 포맷팅합니다.
 */
export function formatSigImportResultMessage(summary: SigImportSummary): string {
  if (summary.status === "failed") {
    return `시그 가져오기 실패: ${summary.error || "알 수 없는 오류"}`;
  }
  const parts: string[] = [];
  parts.push(`총 ${summary.fetchedCount}개 확인`);
  if (summary.addedCount > 0) {
    parts.push(`신규 ${summary.addedCount}개 추가`);
  }
  if (summary.updatedCount > 0) {
    parts.push(`기존 ${summary.updatedCount}개 갱신`);
  }
  if (summary.addedCount === 0 && summary.updatedCount === 0) {
    parts.push(`모두 최신 상태`);
  }
  const detail = parts.join(" · ");
  return `시그 가져오기 완료: ${detail} (현재 총 ${summary.totalCount}개 등록)`;
}
