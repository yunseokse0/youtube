/** 관리자 Toast 컴포넌트(`forbidden-alert` / `app-toast`)용 헬퍼 */

export type AppToastVariant = "success" | "error" | "info";

export function showAppToast(
  text: string,
  opts?: { durationMs?: number; variant?: AppToastVariant }
): void {
  if (typeof window === "undefined") return;
  const trimmed = String(text || "").trim();
  if (!trimmed) return;
  const variant = opts?.variant ?? "success";
  const eventName = variant === "error" ? "forbidden-alert" : "app-toast";
  window.dispatchEvent(
    new CustomEvent(eventName, {
      detail: {
        text: trimmed,
        durationMs: opts?.durationMs,
        variant,
      },
    })
  );
}

export type ServerPersistResult = {
  ok: boolean;
  storageFallback?: boolean;
};

/** admin 설정 저장 — MySQL 반영 여부를 토스트로 명시 */
export function showServerPersistToast(
  actionLabel: string,
  result: ServerPersistResult,
  opts?: { durationMs?: number }
): void {
  const label = String(actionLabel || "").trim() || "설정";
  if (result.ok && !result.storageFallback) {
    showAppToast(`${label} · 서버(MySQL) 저장 완료`, {
      durationMs: opts?.durationMs ?? 3200,
    });
    return;
  }
  if (result.ok && result.storageFallback) {
    showAppToast(
      `${label} · 메모리 fallback만 반영됨 — DATABASE_URL·MySQL 연결을 확인하세요`,
      { variant: "error", durationMs: opts?.durationMs ?? 4500 }
    );
    return;
  }
  showAppToast(`${label} · 서버 저장 실패 — 네트워크·MySQL 확인`, {
    variant: "error",
    durationMs: opts?.durationMs ?? 4500,
  });
}

export function formatHsPushDirLabel(
  dir: "left" | "right" | "split" | "system" | null | undefined,
  systemDir: "left" | "right"
): string {
  if (dir === "left") return "← 왼쪽 수동";
  if (dir === "right") return "→ 오른쪽 수동";
  if (dir === "split") return "↔ 분할 수동";
  const sys = systemDir === "left" ? "←" : "→";
  return `시스템 기본(${sys})`;
}
