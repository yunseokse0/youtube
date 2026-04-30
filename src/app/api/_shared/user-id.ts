import { AUTH_COOKIE, isDevAuthBypassRequest } from "@/lib/auth";

export function getUserIdFromRequest(req: Request): string | null {
  const url = new URL(req.url);
  const fromUrl = url.searchParams.get("user");
  if (fromUrl && fromUrl.trim()) return fromUrl.trim();
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
