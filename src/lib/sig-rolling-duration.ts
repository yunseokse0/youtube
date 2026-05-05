import { decompressFrames, parseGIF } from "gifuct-js";

function absoluteUrlFromPath(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  if (typeof window === "undefined") return path;
  const base = window.location.origin;
  if (path.startsWith("/")) return `${base}${path}`;
  return `${base}/${path}`;
}

export function isProbablyGifPath(url: string): boolean {
  const p = url.split("?")[0].toLowerCase();
  return p.endsWith(".gif");
}

/**
 * GIF 한 루프(재생 1회) 길이(ms). 실패 시 null.
 */
export async function getGifLoopDurationMsFromUrl(pathOrUrl: string): Promise<number | null> {
  try {
    const abs = absoluteUrlFromPath(pathOrUrl);
    const res = await fetch(abs, { cache: "no-store" });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const gif = parseGIF(buf);
    const frames = decompressFrames(gif, true);
    let total = 0;
    for (const f of frames) {
      total += f.delay || 0;
    }
    return total > 0 ? total : null;
  } catch {
    return null;
  }
}

/**
 * 시그 롤링: GIF면 1루프 길이, 아니면 staticHoldMs.
 */
export async function getSigRollingHoldMs(pathOrUrl: string, staticHoldMs: number): Promise<number> {
  if (!isProbablyGifPath(pathOrUrl)) return staticHoldMs;
  const ms = await getGifLoopDurationMsFromUrl(pathOrUrl);
  return ms && ms > 0 ? ms : staticHoldMs;
}
