/**
 * Giphy 웹페이지 URL을 iframe/img에서 쓸 수 있는 직접 GIF 주소로 바꿉니다.
 * 이미 media/i.giphy.com 등 직링크면 그대로 둡니다.
 */
export function resolveGifUrlForEmbed(raw: string): string {
  const s = (raw || "").trim();
  if (!s) return s;
  const lower = s.toLowerCase();
  if (lower.includes("i.giphy.com/") || lower.includes("media.giphy.com/media/")) return s;
  if (!lower.includes("giphy.com")) return s;
  try {
    const u = new URL(s);
    const hostOk = u.hostname === "giphy.com" || u.hostname === "www.giphy.com";
    if (!hostOk) return s;
    const m = u.pathname.match(/\/gifs\/(?:embed\/)?([^/?]+)/);
    if (!m?.[1]) return s;
    const slug = m[1];
    const id = slug.includes("-") ? slug.split("-").pop() || slug : slug;
    if (!id || !/^[a-zA-Z0-9]{6,24}$/.test(id)) return s;
    return `https://i.giphy.com/${id}.gif`;
  } catch {
    return s;
  }
}
