import { AUTH_COOKIE, isDevAuthBypassRequest } from "@/lib/auth";

export function getUserIdFromRequest(req: Request): string | null {
  const url = new URL(req.url);
  /** 오버레이 URL과 동일하게 `u=`만 붙은 폴링도 인식 (OBS·복사 붙여넣기 호환) */
  const fromUrl =
    url.searchParams.get("user")?.trim() ||
    url.searchParams.get("u")?.trim() ||
    "";
  if (fromUrl) return fromUrl;
  const cookie = req.headers.get("cookie") || "";
  const match = cookie.match(new RegExp(`${AUTH_COOKIE}=([^;]+)`));
  if (match) {
    try {
      const parsed = JSON.parse(decodeURIComponent(match[1]));
      return parsed?.id || null;
    } catch {
      return null;
    }
  }
  if (isDevAuthBypassRequest(req)) return "finalent";
  return null;
}
