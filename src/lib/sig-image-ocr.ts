/**
 * 시그 이미지에서 금액 추출 (브라우저 Shape Detection API — Chromium 계열).
 * Safari/Firefox 등에서는 미지원일 수 있음.
 */

export function isSigOcrSupported(): boolean {
  return typeof window !== "undefined" && typeof (window as unknown as { TextDetector?: unknown }).TextDetector === "function";
}

/** OCR로 읽은 문자열에서 한국어 금액 후보 파싱 */
export function parseSigAmountFromText(rawText: string): number | null {
  const text = String(rawText || "").replace(/\s+/g, " ");
  if (!text.trim()) return null;
  const candidates: number[] = [];

  const manRegex = /(\d{1,3})\s*만(?:\s*([0-9]{1,4}))?/g;
  for (const m of text.matchAll(manRegex)) {
    const man = Number(m[1] || 0);
    const tail = Number(m[2] || 0);
    const amount = man * 10000 + tail;
    if (Number.isFinite(amount) && amount >= 1000 && amount <= 100000000) candidates.push(amount);
  }

  const manWonRegex = /(\d{1,3})\s*만\s*원/g;
  for (const m of text.matchAll(manWonRegex)) {
    const man = Number(m[1] || 0);
    const amount = man * 10000;
    if (Number.isFinite(amount) && amount >= 1000 && amount <= 100000000) candidates.push(amount);
  }

  const wonCommaRegex = /(\d{1,3}(?:,\d{3})+|\d{4,})\s*원/g;
  for (const m of text.matchAll(wonCommaRegex)) {
    const digits = String(m[1] || "").replace(/[^\d]/g, "");
    const amount = Number(digits);
    if (Number.isFinite(amount) && amount >= 1000 && amount <= 100000000) candidates.push(amount);
  }

  const numberRegex = /\d[\d,\.\s]{2,}/g;
  for (const m of text.matchAll(numberRegex)) {
    const digits = String(m[0] || "").replace(/[^\d]/g, "");
    if (!digits || digits.length < 3) continue;
    const amount = Number(digits);
    if (Number.isFinite(amount) && amount >= 1000 && amount <= 100000000) candidates.push(amount);
  }

  const digitRuns = text.match(/\d{4,}/g);
  if (digitRuns) {
    for (const run of digitRuns) {
      const amount = Number(run);
      if (Number.isFinite(amount) && amount >= 1000 && amount <= 100000000) candidates.push(amount);
    }
  }

  if (!candidates.length) return null;
  return Math.max(...candidates);
}

function resolveAbsoluteImageUrl(imageUrl: string): string | null {
  const s = String(imageUrl || "").trim();
  if (!s) return null;
  try {
    if (s.startsWith("http://") || s.startsWith("https://")) return s;
    if (typeof window !== "undefined") return new URL(s, window.location.origin).href;
    return s;
  } catch {
    return null;
  }
}

async function loadImageBitmapViaApiProxy(absoluteUrl: string): Promise<ImageBitmap | null> {
  if (typeof window === "undefined") return null;
  if (!/^https?:\/\//i.test(absoluteUrl)) return null;
  try {
    const proxyUrl = `/api/ocr-proxy?url=${encodeURIComponent(absoluteUrl)}`;
    const sig =
      typeof AbortSignal !== "undefined" && typeof (AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }).timeout === "function"
        ? (AbortSignal as unknown as { timeout: (ms: number) => AbortSignal }).timeout(28000)
        : undefined;
    const res = await fetch(proxyUrl, { method: "GET", credentials: "same-origin", signal: sig });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

async function loadImageBitmapForOcr(imageUrl: string): Promise<ImageBitmap | null> {
  if (typeof window === "undefined") return null;
  const abs = resolveAbsoluteImageUrl(imageUrl);
  if (!abs) return null;
  const origin = window.location.origin;
  const sameOrigin = abs.startsWith(origin);

  const loadImg = (crossOrigin: "" | "anonymous") =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new window.Image();
      if (crossOrigin) img.crossOrigin = crossOrigin;
      img.referrerPolicy = "no-referrer";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("img_error"));
      img.src = abs;
    });

  try {
    const img = await loadImg(sameOrigin ? "" : "anonymous");
    return await createImageBitmap(img);
  } catch {
    try {
      if (!sameOrigin) {
        const res = await fetch(abs, { mode: "cors", credentials: "omit" });
        if (!res.ok) throw new Error("fetch");
        const blob = await res.blob();
        return await createImageBitmap(blob);
      }
    } catch {
      /* try anonymous img */
    }
  }
  try {
    const img = await loadImg("anonymous");
    return await createImageBitmap(img);
  } catch {
    /* fall through */
  }

  const proxied = await loadImageBitmapViaApiProxy(abs);
  if (proxied) return proxied;

  return null;
}

const OCR_SCALE_STEPS = [1, 1.5, 2, 2.5, 3] as const;

async function detectPriceFromBitmap(bitmap: ImageBitmap): Promise<number | null> {
  const TD = (window as unknown as { TextDetector?: new (features: string[]) => { detect: (input: ImageBitmap | HTMLCanvasElement) => Promise<Array<{ rawValue?: string }>> } }).TextDetector;
  if (!TD || bitmap.width < 1 || bitmap.height < 1) return null;
  const detector = new TD([]);
  const maxSide = 2000;

  let blocks = await detector.detect(bitmap);
  let merged = blocks.map((b) => String((b as { rawValue?: string }).rawValue || "")).join("\n");
  let price = parseSigAmountFromText(merged);
  if (price != null) return price;

  for (const scale of OCR_SCALE_STEPS) {
    const canvas = document.createElement("canvas");
    let w = Math.max(1, Math.floor(bitmap.width * scale));
    let h = Math.max(1, Math.floor(bitmap.height * scale));
    const longest = Math.max(w, h);
    if (longest > maxSide) {
      const r = maxSide / longest;
      w = Math.max(1, Math.floor(w * r));
      h = Math.max(1, Math.floor(h * r));
    }
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, w, h);
    blocks = await detector.detect(canvas);
    merged = blocks.map((b) => String((b as { rawValue?: string }).rawValue || "")).join("\n");
    price = parseSigAmountFromText(merged);
    if (price != null) return price;
  }
  return null;
}

export async function detectSigPriceFromImageUrl(imageUrl: string): Promise<number | null> {
  const meta = await detectSigPriceFromImageUrlDetailed(imageUrl);
  return meta.price;
}

export type SigOcrDetail = {
  price: number | null;
  reason?: "unsupported_browser" | "image_load_failed" | "no_amount_found";
  previewText?: string;
};

export async function detectSigPriceFromImageUrlDetailed(imageUrl: string): Promise<SigOcrDetail> {
  if (!isSigOcrSupported()) {
    return { price: null, reason: "unsupported_browser" };
  }
  const bitmap = await loadImageBitmapForOcr(imageUrl);
  if (!bitmap) {
    return { price: null, reason: "image_load_failed" };
  }
  try {
    const price = await detectPriceFromBitmap(bitmap);
    if (price == null) {
      const TD = (window as unknown as { TextDetector?: new (f: string[]) => { detect: (i: ImageBitmap) => Promise<Array<{ rawValue?: string }>> } }).TextDetector;
      let previewText = "";
      if (TD) {
        const detector = new TD([]);
        const blocks = await detector.detect(bitmap);
        previewText = blocks.map((b) => String((b as { rawValue?: string }).rawValue || "")).join(" ").slice(0, 120);
      }
      return { price: null, reason: "no_amount_found", previewText: previewText || undefined };
    }
    return { price };
  } finally {
    try {
      bitmap.close();
    } catch {
      /* ignore */
    }
  }
}

export async function detectSigPriceFromImageFile(file: File): Promise<number | null> {
  if (!isSigOcrSupported()) return null;
  try {
    const bitmap = await createImageBitmap(file);
    try {
      return await detectPriceFromBitmap(bitmap);
    } finally {
      try {
        bitmap.close();
      } catch {
        /* ignore */
      }
    }
  } catch {
    return null;
  }
}
