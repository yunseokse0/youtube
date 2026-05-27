/** 로컬·LAN 전용 도구 페이지 접근 (휠 데모와 동일 기준) */

export function isLocalDevHost(hostnameOrHost: string): boolean {
  const h = String(hostnameOrHost || "")
    .toLowerCase()
    .split(":")[0];
  if (!h) return false;
  if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]") return true;
  if (h.endsWith(".local")) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return false;
}

export function isLocalSigManagerAllowed(hostnameOrHost: string): boolean {
  return isLocalDevHost(hostnameOrHost);
}
