export const runtime = "edge";
export const revalidate = 0;

/**
 * 구 관리자 번들이 호출하던 경로 — `/api/roulette/finish`와 동일 처리(404·500 방지).
 */
export { POST } from "@/app/api/roulette/finish/route";
