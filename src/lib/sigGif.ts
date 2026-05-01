/** GIF 확장자·data URL 여부 (쿼리·해시 제거 후 검사) */
export function isLikelyGifUrl(url: string): boolean {
  const s = url.trim().toLowerCase();
  if (!s) return false;
  if (s.startsWith("data:image/gif")) return true;
  const base = s.split("#")[0]?.split("?")[0] ?? "";
  return base.endsWith(".gif");
}
