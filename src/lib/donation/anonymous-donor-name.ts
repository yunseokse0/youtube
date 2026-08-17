import { normalizeComparableName } from "@/lib/donation/name-similarity";

const ANONYMOUS_DISPLAY_NAME = "익명";

/** Unknown / anonymous / anon / 익명 플레이스홀더 (대소문자·기호 무시) */
export function isAnonymousDonorPlaceholderName(name: string): boolean {
  const key = normalizeComparableName(name);
  return (
    key === "unknown" ||
    key === "anonymous" ||
    key === "anon" ||
    key === "익명"
  );
}

/** 후원순위·목록 표시·저장용 — UNKNOWN 등을 「익명」으로 통일 */
export function normalizeAnonymousDonorDisplayName(name: string): string {
  const raw = String(name || "").trim();
  if (!raw) return "무명";
  if (isAnonymousDonorPlaceholderName(raw)) return ANONYMOUS_DISPLAY_NAME;
  return raw;
}
