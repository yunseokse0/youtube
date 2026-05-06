/**
 * 시그 이미지에서 금액 추출.
 * 1) Chromium TextDetector(가능 시)
 * 2) tesseract.js(kor+eng) 폴백 — Safari/Firefox 등에서도 시도 가능
 */

export function isSigOcrSupported(): boolean {
  return typeof window !== "undefined";
}

/** Shape Detection API(TextDetector) 사용 가능 여부 (Chromium 등) */
export function isNativeTextDetectorAvailable(): boolean {
  return typeof window !== "undefined" && typeof (window as unknown as { TextDetector?: unknown }).TextDetector === "function";
}

/** OCR 잡음 제거: 전각 숫자·통화 기호 정규화 */
function normalizeOcrTextForAmountParse(raw: string): string {
  let s = String(raw || "");
  s = s.replace(/[\uFF10-\uFF19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30));
  s = s.replace(/\uFF0C/g, ","); // 전각 쉼표 → 반각
  s = s.replace(/[₩￦]/g, "원");
  return s.replace(/\s+/g, " ").trim();
}

/** OCR로 읽은 문자열에서 한국어 금액 후보 파싱 */
export function parseSigAmountFromText(rawText: string): number | null {
  const text = normalizeOcrTextForAmountParse(rawText);
  if (!text.trim()) return null;
  const candidates: number[] = [];

  /** 소수 만을 정수 만보다 먼저 (예: 7.7만 → 7만으로 오인 방지) */
  const manDecimalRegex = /(\d+(?:\.\d+)?)\s*만\s*원?/g;
  for (const m of text.matchAll(manDecimalRegex)) {
    const n = parseFloat(String(m[1] || "").replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    const amount = Math.round(n * 10000);
    if (amount >= 1000 && amount <= 100000000) candidates.push(amount);
  }

  const manRegex = /(\d{1,3})\s*만(?:\s*([0-9]{1,4}))?/g;
  for (const m of text.matchAll(manRegex)) {
    const man = Number(m[1] || 0);
    const tail = Number(m[2] || 0);
    const amount = man * 10000 + tail;
    if (Number.isFinite(amount) && amount >= 1000 && amount <= 100000000) candidates.push(amount);
  }

  const cheonWonRegex = /(\d{1,4})\s*천\s*원/g;
  for (const m of text.matchAll(cheonWonRegex)) {
    const amount = Number(m[1] || 0) * 1000;
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

  const wonTightRegex = /(\d{1,3}(?:,\d{3})+|\d{4,})원/g;
  for (const m of text.matchAll(wonTightRegex)) {
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
  if (s.startsWith("data:") || s.startsWith("blob:")) return s;
  try {
    if (s.startsWith("http://") || s.startsWith("https://")) return s;
    if (typeof window !== "undefined") return new URL(s, window.location.origin).href;
    return s;
  } catch {
    return null;
  }
}

export type SigImageLoadInfo = {
  bitmap: ImageBitmap | null;
  /** fetch 실패 시 HTTP 상태(예: 404). 알 수 없으면 생략 */
  failedHttpStatus?: number;
};

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

async function loadImageForOcr(imageUrl: string): Promise<SigImageLoadInfo> {
  if (typeof window === "undefined") return { bitmap: null };
  const abs = resolveAbsoluteImageUrl(imageUrl);
  if (!abs) return { bitmap: null };

  const origin = window.location.origin;
  const sameOrigin = abs.startsWith(origin);
  const isHttp = /^https?:\/\//i.test(abs);

  if (abs.startsWith("blob:") || abs.startsWith("data:")) {
    try {
      const res = await fetch(abs);
      if (!res.ok) return { bitmap: null, failedHttpStatus: res.status };
      const blob = await res.blob();
      const bitmap = await createImageBitmap(blob);
      return { bitmap };
    } catch {
      return { bitmap: null };
    }
  }

  const loadImg = (crossOrigin: "" | "anonymous") =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new window.Image();
      if (crossOrigin) img.crossOrigin = crossOrigin;
      img.referrerPolicy = "no-referrer";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("img_error"));
      img.src = abs;
    });

  const fetchAsBitmap = async (url: string, init: RequestInit): Promise<SigImageLoadInfo> => {
    try {
      const res = await fetch(url, init);
      if (!res.ok) return { bitmap: null, failedHttpStatus: res.status };
      const blob = await res.blob();
      const bitmap = await createImageBitmap(blob);
      return { bitmap };
    } catch {
      return { bitmap: null };
    }
  };

  // 동일 출처: fetch로 먼저 시도 → 404 등 원인 파악 가능(배포 서버에 /public 파일 없음 등)
  if (sameOrigin) {
    const direct = await fetchAsBitmap(abs, { mode: "same-origin", credentials: "same-origin" });
    if (direct.bitmap) return direct;
    const failSt = direct.failedHttpStatus;
    try {
      const img = await loadImg("");
      const bitmap = await createImageBitmap(img);
      return { bitmap };
    } catch {
      return { bitmap: null, failedHttpStatus: failSt };
    }
  }

  // 크로스 오리진 HTTP(S): 프록시 우선
  if (isHttp) {
    const proxied = await loadImageBitmapViaApiProxy(abs);
    if (proxied) return { bitmap: proxied };
    const corsTry = await fetchAsBitmap(abs, { mode: "cors", credentials: "omit" });
    if (corsTry.bitmap) return corsTry;
    try {
      const img = await loadImg("anonymous");
      const bitmap = await createImageBitmap(img);
      return { bitmap };
    } catch {
      return { bitmap: null, failedHttpStatus: corsTry.failedHttpStatus };
    }
  }

  try {
    const img = await loadImg("anonymous");
    const bitmap = await createImageBitmap(img);
    return { bitmap };
  } catch {
    return { bitmap: null };
  }
}

/** GIF/WebP 애니 등 첫 프레임으로 고정 + OCR용 업스케일 */
const OCR_MAX_SIDE = 2400;
const OCR_MIN_SHORT_EDGE = 360;

async function flattenToStaticImageBitmap(bitmap: ImageBitmap): Promise<ImageBitmap> {
  if (bitmap.width < 1 || bitmap.height < 1) return bitmap;
  const c = document.createElement("canvas");
  c.width = bitmap.width;
  c.height = bitmap.height;
  const ctx = c.getContext("2d");
  if (!ctx) return bitmap;
  ctx.drawImage(bitmap, 0, 0);
  return await createImageBitmap(c);
}

function canvasToGrayscale(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext("2d");
  if (!ctx) return canvas;
  ctx.drawImage(canvas, 0, 0);
  const imgData = ctx.getImageData(0, 0, out.width, out.height);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = y;
  }
  ctx.putImageData(imgData, 0, 0);
  return out;
}

function buildScaledColorCanvasForOcr(bitmap: ImageBitmap): HTMLCanvasElement | null {
  const w0 = bitmap.width;
  const h0 = bitmap.height;
  if (w0 < 1 || h0 < 1) return null;
  let scale = 1;
  const short = Math.min(w0, h0);
  if (short < OCR_MIN_SHORT_EDGE) {
    scale = OCR_MIN_SHORT_EDGE / short;
  }
  let nw = Math.max(1, Math.floor(w0 * scale));
  let nh = Math.max(1, Math.floor(h0 * scale));
  const longest = Math.max(nw, nh);
  if (longest > OCR_MAX_SIDE) {
    const r = OCR_MAX_SIDE / longest;
    nw = Math.max(1, Math.floor(nw * r));
    nh = Math.max(1, Math.floor(nh * r));
  }
  const color = document.createElement("canvas");
  color.width = nw;
  color.height = nh;
  const ctx = color.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, nw, nh);
  return color;
}

/** 업로드 파일: `<img>` 첫 프레임 디코딩(GIF·저해상도 호환) */
async function decodeFileToFirstFrameBitmap(file: File): Promise<ImageBitmap> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode_failed"));
      el.src = url;
    });
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (w < 1 || h < 1) return await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return await createImageBitmap(file);
    ctx.drawImage(img, 0, 0);
    return await createImageBitmap(canvas);
  } catch {
    return await createImageBitmap(file);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const OCR_SCALE_STEPS = [1, 1.5, 2, 2.5, 3] as const;

async function detectPriceFromBitmapNative(bitmap: ImageBitmap): Promise<number | null> {
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

async function detectPriceWithTesseractDetailed(bitmap: ImageBitmap): Promise<{ price: number | null; rawText: string }> {
  if (typeof window === "undefined") return { price: null, rawText: "" };

  const colorCanvas = buildScaledColorCanvasForOcr(bitmap);
  if (!colorCanvas) return { price: null, rawText: "" };

  const makeDownscaled = (src: HTMLCanvasElement, maxSide: number): HTMLCanvasElement => {
    const longest = Math.max(src.width, src.height);
    if (longest <= maxSide) return src;
    const r = maxSide / longest;
    const w = Math.max(1, Math.floor(src.width * r));
    const h = Math.max(1, Math.floor(src.height * r));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return src;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, 0, 0, w, h);
    return c;
  };

  const grayCanvas = canvasToGrayscale(colorCanvas);
  const smallColorCanvas = makeDownscaled(colorCanvas, 1400);
  const smallGrayCanvas = makeDownscaled(grayCanvas, 1400);

  const attemptLang = async (langs: string): Promise<{ price: number | null; rawText: string }> => {
    const { createWorker, PSM } = await import("tesseract.js");
    const worker = await createWorker(langs, undefined, {
      logger: () => {},
      errorHandler: () => {},
    });
    let longestText = "";
    try {
      const modes = [PSM.SPARSE_TEXT, PSM.SINGLE_BLOCK, PSM.SINGLE_LINE, PSM.AUTO] as const;
      const canvases = [colorCanvas, grayCanvas, smallColorCanvas, smallGrayCanvas];

      for (const canvas of canvases) {
        for (const psm of modes) {
          await worker.setParameters({
            tessedit_pageseg_mode: psm,
            tessedit_char_whitelist: "0123456789,.-만원천원 ",
          });
          const {
            data: { text },
          } = await worker.recognize(canvas);
          const trimmed = String(text || "").trim();
          if (trimmed.length > longestText.length) longestText = trimmed;
          const price = parseSigAmountFromText(trimmed);
          if (price != null) return { price, rawText: trimmed };
        }
      }
      return { price: null, rawText: longestText };
    } finally {
      await worker.terminate();
    }
  };

  // 숫자 OCR은 eng가 훨씬 가볍고 wasm 오류가 적어서 먼저 시도
  try {
    const eng = await attemptLang("eng");
    if (eng.price != null || eng.rawText) return eng;
  } catch (e) {
    console.warn("[sig ocr] tesseract eng failed", e);
  }

  try {
    return await attemptLang("kor+eng");
  } catch (e) {
    console.warn("[sig ocr] tesseract kor+eng failed", e);
    return { price: null, rawText: "" };
  }
}

async function detectPriceFromBitmapDetailed(bitmap: ImageBitmap): Promise<{ price: number | null; previewText?: string }> {
  if (bitmap.width < 1 || bitmap.height < 1) return { price: null };

  const TD = (window as unknown as { TextDetector?: new (features: string[]) => { detect: (input: ImageBitmap | HTMLCanvasElement) => Promise<Array<{ rawValue?: string }>> } }).TextDetector;

  if (TD) {
    const native = await detectPriceFromBitmapNative(bitmap);
    if (native != null) return { price: native };
  }

  const tess = await detectPriceWithTesseractDetailed(bitmap);
  if (tess.price != null) return { price: tess.price };

  let previewText = tess.rawText ? tess.rawText.replace(/\s+/g, " ").slice(0, 120) : undefined;
  if (!previewText && TD) {
    const detector = new TD([]);
    const blocks = await detector.detect(bitmap);
    previewText = blocks.map((b) => String((b as { rawValue?: string }).rawValue || "")).join(" ").slice(0, 120) || undefined;
  }

  return { price: null, previewText };
}

async function detectPriceFromBitmap(bitmap: ImageBitmap): Promise<number | null> {
  const d = await detectPriceFromBitmapDetailed(bitmap);
  return d.price;
}

export async function detectSigPriceFromImageUrl(imageUrl: string): Promise<number | null> {
  const meta = await detectSigPriceFromImageUrlDetailed(imageUrl);
  return meta.price;
}

export type SigOcrDetail = {
  price: number | null;
  reason?: "unsupported_browser" | "image_load_failed" | "image_not_found" | "no_amount_found";
  previewText?: string;
  /** 이미지 로드 실패 시 알려진 HTTP 상태(주로 404) */
  imageHttpStatus?: number;
};

export async function detectSigPriceFromImageUrlDetailed(imageUrl: string): Promise<SigOcrDetail> {
  if (typeof window === "undefined") {
    return { price: null, reason: "unsupported_browser" };
  }
  const { bitmap: loaded, failedHttpStatus } = await loadImageForOcr(imageUrl);
  if (!loaded) {
    if (failedHttpStatus === 404) {
      return { price: null, reason: "image_not_found", imageHttpStatus: 404 };
    }
    return { price: null, reason: "image_load_failed", imageHttpStatus: failedHttpStatus };
  }
  const bitmap = await flattenToStaticImageBitmap(loaded);
  try {
    loaded.close();
  } catch {
    /* ignore */
  }
  try {
    const { price, previewText } = await detectPriceFromBitmapDetailed(bitmap);
    if (price == null) {
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
  if (typeof window === "undefined") return null;
  try {
    const raw = await decodeFileToFirstFrameBitmap(file);
    const bitmap = await flattenToStaticImageBitmap(raw);
    try {
      raw.close();
    } catch {
      /* ignore */
    }
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
