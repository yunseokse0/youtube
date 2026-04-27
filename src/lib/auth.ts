/**
 * 로그인 인증 (단일 사용자)
 * id: finalent, password: finalent
 * - finalent: 기존 데이터가 반드시 이 계정으로 사용됨 (마이그레이션 보장)
 */
export const AUTH_COOKIE = "sb_user";

export const USERS: Record<string, { companyName: string; password: string }> = {
  finalent: {
    companyName: "Final Entertainment",
    password: "finalent",
  },
};

export function validateUser(id: string, password: string): { id: string; companyName: string } | null {
  const u = USERS[id?.trim().toLowerCase()];
  if (!u || u.password !== (password || "")) return null;
  return { id: id.trim().toLowerCase(), companyName: u.companyName };
}

export function getUserById(id: string): { id: string; companyName: string } | null {
  const u = USERS[id?.trim().toLowerCase()];
  if (!u) return null;
  return { id: id.trim().toLowerCase(), companyName: u.companyName };
}

function isLocalHost(hostname: string): boolean {
  if (!hostname) return false;
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]") return true;
  return false;
}

export function isDevAuthBypassRequest(req: Request): boolean {
  try {
    const hostname = new URL(req.url).hostname.toLowerCase();
    if (isLocalHost(hostname)) return true;
  } catch {}
  const hostHeader = (req.headers.get("host") || "").toLowerCase().split(":")[0];
  if (isLocalHost(hostHeader)) return true;
  if (process.env.NODE_ENV === "production") return false;
  return true;
}
