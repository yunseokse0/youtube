import { isDevAuthBypassRequest } from "@/lib/auth";

/** localhost 또는 개발 bypass — 프로덕션 외 더미 시드 API용 */
export function assertLocalDev(req: Request): boolean {
  try {
    const host = new URL(req.url).hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
  } catch {}
  return isDevAuthBypassRequest(req) && process.env.NODE_ENV !== "production";
}
