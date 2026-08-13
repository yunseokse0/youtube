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
