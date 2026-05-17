import { decompressFrames, parseGIF } from "gifuct-js";
import type { ParsedFrame } from "gifuct-js";

export function isGifArrayBuffer(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 6) return false;
  const u8 = new Uint8Array(buf, 0, 6);
  const head = String.fromCharCode(u8[0], u8[1], u8[2], u8[3], u8[4], u8[5]);
  return head === "GIF87a" || head === "GIF89a";
}

/** 애니 GIF에서 OCR할 프레임 인덱스(합성 누적 기준, 최대 maxFrames) */
export function pickGifFrameIndices(frameCount: number, maxFrames = 20): number[] {
  if (frameCount <= 0) return [];
  if (frameCount === 1) return [0];
  if (frameCount <= maxFrames) {
    return Array.from({ length: frameCount }, (_, i) => i);
  }
  const set = new Set<number>();
  set.add(0);
  set.add(frameCount - 1);
  for (const frac of [0.08, 0.12, 0.25, 0.38, 0.5, 0.62, 0.75, 0.88]) {
    set.add(Math.min(frameCount - 1, Math.round(frac * (frameCount - 1))));
  }
  const step = Math.max(1, Math.floor(frameCount / Math.max(1, maxFrames - 1)));
  for (let i = 0; i < frameCount; i += step) {
    set.add(i);
  }
  for (let i = 6; i < Math.min(frameCount, 24); i += 2) {
    set.add(i);
  }
  let result = [...set].sort((a, b) => a - b);
  if (result.length > maxFrames) {
    const picked: number[] = [];
    for (let k = 0; k < maxFrames; k++) {
      const pos = Math.round((k / Math.max(1, maxFrames - 1)) * (result.length - 1));
      picked.push(result[pos]!);
    }
    result = [...new Set(picked)].sort((a, b) => a - b);
  }
  if (frameCount > 1 && !result.includes(frameCount - 1)) {
    if (result.length >= maxFrames) result[result.length - 1] = frameCount - 1;
    else result.push(frameCount - 1);
    result.sort((a, b) => a - b);
  }
  return result;
}

const SIG_PRICE_MIN = 1000;
const SIG_PRICE_MAX = 1_500_000;
/** 단일 프레임 OCR만으로는 이 금액 이상을 신뢰하지 않음(잡음 방지) */
const SIG_PRICE_SOFT_MAX = 350_000;

function removeOutlierSigPrices(values: number[]): number[] {
  if (values.length <= 2) return values;
  let sorted = [...values].sort((a, b) => a - b);
  while (sorted.length > 1 && sorted[sorted.length - 1]! / Math.max(sorted[0]!, 1) > 12) {
    sorted = sorted.slice(0, -1);
  }
  return sorted;
}

function scoreSigPriceCandidate(price: number): number {
  let score = 0;
  /** 시그 실가격대(약 2만~15만) — 38700·31200 등 */
  if (price >= 20_000 && price <= 150_000) score += 5;
  else if (price >= 10_000 && price <= 500_000) score += 2;
  if (price >= 2_000 && price <= 999_999) score += 2;
  else if (price >= SIG_PRICE_MIN && price <= SIG_PRICE_MAX) score += 1;
  if (price % 100 === 0) score += 1;
  if (price < 10_000) score -= 3;
  if (price > 999_999) score -= 6;
  return score;
}

/** 여러 프레임 OCR 결과에서 대표 가격 선택(동일 값 2회 이상 우선, 잡음은 이상치·과대 숫자 제거) */
export function pickConsensusSigPrice(candidates: number[]): number | null {
  const filtered = candidates.filter((p) => p >= SIG_PRICE_MIN && p <= SIG_PRICE_MAX);
  if (!filtered.length) return null;

  const counts = new Map<number, number>();
  for (const p of filtered) {
    counts.set(p, (counts.get(p) || 0) + 1);
  }
  const forVote = filtered.filter((p) => p <= SIG_PRICE_SOFT_MAX || (counts.get(p) || 0) >= 2);
  let pool = forVote.length ? forVote : filtered;
  if (!forVote.length && filtered.every((p) => p > SIG_PRICE_SOFT_MAX)) {
    if (filtered.length === 1) {
      const only = filtered[0]!;
      if (only % 1000 === 0) return only;
      return null;
    }
    return null;
  }
  if (!forVote.length && filtered.some((p) => p > SIG_PRICE_SOFT_MAX)) {
    pool = filtered.filter((p) => p <= SIG_PRICE_SOFT_MAX);
    if (!pool.length) return null;
  }

  let best: number | null = null;
  let bestCount = 0;
  for (const [price, count] of counts) {
    if (!pool.includes(price)) continue;
    if (count > bestCount || (count === bestCount && best != null && price > best)) {
      best = price;
      bestCount = count;
    }
  }
  if (bestCount >= 2 && best != null) return best;

  const trimmed = removeOutlierSigPrices(pool);
  if (!trimmed.length) return null;
  if (trimmed.length === 1) return trimmed[0]!;

  let picked = trimmed[0]!;
  let pickedScore = scoreSigPriceCandidate(picked);
  for (const p of trimmed) {
    const sc = scoreSigPriceCandidate(p);
    if (sc > pickedScore || (sc === pickedScore && p > picked)) {
      picked = p;
      pickedScore = sc;
    }
  }
  return picked;
}

type GifParsed = ReturnType<typeof parseGIF>;

function drawFramePatch(
  frame: ParsedFrame,
  target: CanvasRenderingContext2D,
  tempCanvas: HTMLCanvasElement,
  patchCtx: CanvasRenderingContext2D,
  frameImageDataRef: { current: ImageData | null }
): void {
  const dims = frame.dims;
  let frameImageData = frameImageDataRef.current;
  if (!frameImageData || dims.width !== frameImageData.width || dims.height !== frameImageData.height) {
    tempCanvas.width = dims.width;
    tempCanvas.height = dims.height;
    frameImageData = patchCtx.createImageData(dims.width, dims.height);
    frameImageDataRef.current = frameImageData;
  }
  frameImageData.data.set(frame.patch);
  patchCtx.putImageData(frameImageData, 0, 0);
  target.drawImage(tempCanvas, dims.left, dims.top);
}

/** 0..endIndex 프레임까지 누적 합성(시그 GIF 재생 화면과 동일) */
export function renderGifCompositeCanvas(
  gif: GifParsed,
  frames: ParsedFrame[],
  endIndex: number
): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const w = gif.lsd.width;
  const h = gif.lsd.height;
  if (w < 1 || h < 1 || !frames.length) return null;

  const display = document.createElement("canvas");
  display.width = w;
  display.height = h;
  const displayCtx = display.getContext("2d");
  if (!displayCtx) return null;

  const tempCanvas = document.createElement("canvas");
  const patchCtx = tempCanvas.getContext("2d");
  if (!patchCtx) return null;

  const frameImageDataRef = { current: null as ImageData | null };
  const last = Math.min(endIndex, frames.length - 1);

  for (let i = 0; i <= last; i++) {
    const frame = frames[i];
    if (frame.disposalType === 2) {
      displayCtx.clearRect(0, 0, w, h);
    }
    drawFramePatch(frame, displayCtx, tempCanvas, patchCtx, frameImageDataRef);
  }
  return display;
}

export type GifFrameDecodeResult = {
  frameCount: number;
  indices: number[];
};

export function decodeGifFramePlan(buf: ArrayBuffer, maxFrames = 12): GifFrameDecodeResult | null {
  if (!isGifArrayBuffer(buf)) return null;
  try {
    const gif = parseGIF(buf);
    const frames = decompressFrames(gif, true);
    if (!frames.length) return null;
    return {
      frameCount: frames.length,
      indices: pickGifFrameIndices(frames.length, maxFrames),
    };
  } catch {
    return null;
  }
}

export async function createBitmapsFromGifBuffer(
  buf: ArrayBuffer,
  maxFrames = 12
): Promise<{ bitmaps: ImageBitmap[]; frameCount: number } | null> {
  if (typeof document === "undefined") return null;
  if (!isGifArrayBuffer(buf)) return null;
  try {
    const gif = parseGIF(buf);
    const frames = decompressFrames(gif, true);
    if (!frames.length) return null;
    const indices = pickGifFrameIndices(frames.length, maxFrames);
    const bitmaps: ImageBitmap[] = [];
    for (const idx of indices) {
      const canvas = renderGifCompositeCanvas(gif, frames, idx);
      if (!canvas) continue;
      bitmaps.push(await createImageBitmap(canvas));
    }
    return { bitmaps, frameCount: frames.length };
  } catch {
    return null;
  }
}
