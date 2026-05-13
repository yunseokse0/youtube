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

export type AnimatedEmbedSource = {
  src: string;
  kind: "image" | "video";
};

function extractGiphyId(raw: string): string | null {
  const s = (raw || "").trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    const host = u.hostname.toLowerCase();
    // giphy page url: /gifs/...-<id>
    if (host === "giphy.com" || host === "www.giphy.com") {
      const m = u.pathname.match(/\/gifs\/(?:embed\/)?([^/?]+)/);
      if (!m?.[1]) return null;
      const slug = m[1];
      const id = slug.includes("-") ? slug.split("-").pop() || slug : slug;
      return /^[a-zA-Z0-9]{6,24}$/.test(id) ? id : null;
    }
    // i.giphy.com/<id>.gif
    if (host === "i.giphy.com") {
      const m = u.pathname.match(/^\/([a-zA-Z0-9]{6,24})\.gif$/);
      return m?.[1] || null;
    }
    // media.giphy.com/media/<id>/giphy.gif
    if (host === "media.giphy.com") {
      const m = u.pathname.match(/^\/media\/([a-zA-Z0-9]{6,24})\//);
      return m?.[1] || null;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * 오버레이 배경(GIF/MP4) URL: ImageKit 등 제거된 CDN·404 유발 주소는 빈 문자열로 두어
 * 브라우저 요청·동기화 실패(콘솔 폭주)를 막습니다.
 * — Supabase Storage 공개 URL, Giphy, 상대 경로는 유지합니다.
 */
export function sanitizeOverlayEmbedMediaUrl(raw: unknown): string {
  const s = String(raw ?? "").trim().replace(/\\/g, "/");
  if (!s) return "";
  if (s.startsWith("data:") || s.startsWith("blob:")) return s;
  const lower = s.toLowerCase();
  if (lower.includes("imagekit.io")) return "";
  if (/\/sig_images(\/|$|\?)/i.test(s) || /^sig_images(\/|$|\?)/i.test(s)) return "";
  if (/^https?:\/\//i.test(s)) {
    if (/^https?:\/\/[^/]*supabase\.co\/storage\/v1\/object\/public\//i.test(s)) return s;
    if (lower.includes("giphy.com")) return s;
    if (lower.includes("i.giphy.com")) return s;
    if (lower.includes("media.giphy.com")) return s;
    return "";
  }
  return s;
}

/**
 * 반복 재생이 필요한 배경용 소스 해석.
 * - giphy 계열은 루프가 더 부드러운 mp4를 우선 사용
 * - 그 외는 확장자 기준으로 이미지/비디오 판별
 */
export function resolveAnimatedSourceForEmbed(raw: string): AnimatedEmbedSource {
  const s0 = sanitizeOverlayEmbedMediaUrl(raw);
  const s = s0.trim();
  if (!s) return { src: "", kind: "image" };

  const giphyId = extractGiphyId(s);
  if (giphyId) {
    return {
      src: `https://media.giphy.com/media/${giphyId}/giphy.mp4`,
      kind: "video",
    };
  }

  const lower = s.toLowerCase();
  if (lower.endsWith(".mp4") || lower.endsWith(".webm")) return { src: s, kind: "video" };
  return { src: resolveGifUrlForEmbed(s), kind: "image" };
}
