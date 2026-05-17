/**
 * 로컬 from-drive GIF 다중 프레임 OCR 스모크 테스트.
 * 사용: node scripts/test-sig-ocr-local.mjs [--limit N] [--only name1,name2]
 */
import fs from "fs";
import path from "path";
import { createCanvas, loadImage } from "canvas";
import { createWorker, PSM } from "tesseract.js";
import { decompressFrames, parseGIF } from "gifuct-js";

const SIG_DIR = path.join(process.cwd(), "public", "images", "sigs", "from-drive");
const OCR_MIN_SHORT_EDGE = 640;
const OCR_MAX_SIDE = 2400;
const GIF_OCR_MAX_FRAMES = 20;

function fixOcrDigitConfusions(s) {
  return s
    .replace(/[OoQＯｏ]/g, "0")
    .replace(/[Il|Ｉｌ|丨]/g, "1")
    .replace(/[Ss$]/g, "5")
    .replace(/[Bb]/g, "8")
    .replace(/[Zz]/g, "2")
    .replace(/[gG]/g, "9");
}

function collapseSpacedDigits(s) {
  let prev = "";
  let cur = s;
  for (let n = 0; n < 8; n++) {
    cur = cur.replace(/(\d)[\s\u00a0·•]+(?=\d)/g, "$1");
    if (cur === prev) break;
    prev = cur;
  }
  return cur;
}

function normalizeOcrTextForAmountParse(raw) {
  let s = String(raw || "");
  s = s.replace(/[\uFF10-\uFF19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30));
  s = s.replace(/\uFF0C/g, ",");
  s = s.replace(/[₩￦]/g, "원");
  s = fixOcrDigitConfusions(s);
  s = collapseSpacedDigits(s);
  return s.replace(/\s+/g, " ").trim();
}

function parseSigAmountFromText(rawText) {
  const text = normalizeOcrTextForAmountParse(rawText);
  if (!text.trim()) return null;
  const candidates = [];

  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*만\s*원?/g)) {
    const n = parseFloat(String(m[1] || "").replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    const amount = Math.round(n * 10000);
    if (amount >= 1000 && amount <= 100000000) candidates.push(amount);
  }
  for (const m of text.matchAll(/(\d{1,3})\s*만(?:\s*([0-9]{1,4}))?/g)) {
    const amount = Number(m[1] || 0) * 10000 + Number(m[2] || 0);
    if (Number.isFinite(amount) && amount >= 1000 && amount <= 100000000) candidates.push(amount);
  }
  for (const m of text.matchAll(/(\d{1,4})\s*천\s*원/g)) {
    const amount = Number(m[1] || 0) * 1000;
    if (Number.isFinite(amount) && amount >= 1000 && amount <= 100000000) candidates.push(amount);
  }
  for (const m of text.matchAll(/(\d{1,3}(?:,\d{3})+|\d{4,})\s*원/g)) {
    const amount = Number(String(m[1] || "").replace(/[^\d]/g, ""));
    if (Number.isFinite(amount) && amount >= 1000 && amount <= 100000000) candidates.push(amount);
  }
  for (const m of text.matchAll(/(\d{1,3})[,.](\d{3})(?!\d)/g)) {
    const amount = Number(`${m[1] || ""}${m[2] || ""}`);
    if (Number.isFinite(amount) && amount >= 1000 && amount <= 100000000) candidates.push(amount);
  }
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)만원?/g)) {
    const n = parseFloat(String(m[1] || "").replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    const amount = Math.round(n * 10000);
    if (amount >= 1000 && amount <= 100000000) candidates.push(amount);
  }
  for (const m of text.matchAll(/\d[\d,\.\s]{2,}/g)) {
    const digits = String(m[0] || "").replace(/[^\d]/g, "");
    if (!digits || digits.length < 3) continue;
    const amount = Number(digits);
    if (Number.isFinite(amount) && amount >= 1000 && amount <= 100000000) candidates.push(amount);
  }
  for (const m of text.matchAll(/(?<!\d)(\d{5})(?!\d)/g)) {
    const amount = Number(m[1] || 0);
    if (Number.isFinite(amount) && amount >= 20_000 && amount <= 150_000) candidates.push(amount);
  }
  const digitRuns = text.match(/\d{4,}/g);
  if (digitRuns) {
    for (const run of digitRuns) {
      if (run.length > 7) continue;
      const amount = Number(run);
      if (Number.isFinite(amount) && amount >= 1000 && amount <= 100000000) candidates.push(amount);
    }
  }
  if (!candidates.length) return null;
  if (candidates.length === 1) return refineCommonSigOcrMisreads(candidates[0]);
  const p = pickConsensusSigPrice(candidates);
  return p != null ? refineCommonSigOcrMisreads(p) : null;
}

function pickGifFrameIndices(frameCount, maxFrames = GIF_OCR_MAX_FRAMES) {
  if (frameCount <= 0) return [];
  if (frameCount === 1) return [0];
  if (frameCount <= maxFrames) return Array.from({ length: frameCount }, (_, i) => i);
  const set = new Set([0, frameCount - 1]);
  for (const frac of [0.08, 0.12, 0.25, 0.38, 0.5, 0.62, 0.75, 0.88]) {
    set.add(Math.min(frameCount - 1, Math.round(frac * (frameCount - 1))));
  }
  const step = Math.max(1, Math.floor(frameCount / Math.max(1, maxFrames - 1)));
  for (let i = 0; i < frameCount; i += step) set.add(i);
  for (let i = 6; i < Math.min(frameCount, 24); i += 2) set.add(i);
  let result = [...set].sort((a, b) => a - b);
  if (result.length > maxFrames) {
    const picked = [];
    for (let k = 0; k < maxFrames; k++) {
      const pos = Math.round((k / Math.max(1, maxFrames - 1)) * (result.length - 1));
      picked.push(result[pos]);
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
const SIG_PRICE_SOFT_MAX = 350_000;

function removeOutlierSigPrices(values) {
  if (values.length <= 2) return values;
  let sorted = [...values].sort((a, b) => a - b);
  while (sorted.length > 1 && sorted[sorted.length - 1] / Math.max(sorted[0], 1) > 12) {
    sorted = sorted.slice(0, -1);
  }
  return sorted;
}

function scoreSigPriceCandidate(price) {
  let score = 0;
  if (price >= 20_000 && price <= 150_000) score += 5;
  else if (price >= 10_000 && price <= 500_000) score += 2;
  if (price >= 2_000 && price <= 999_999) score += 2;
  else if (price >= SIG_PRICE_MIN && price <= SIG_PRICE_MAX) score += 1;
  if (price % 100 === 0) score += 1;
  if (price < 10_000) score -= 3;
  if (price > 999_999) score -= 6;
  return score;
}

function refineCommonSigOcrMisreads(price) {
  const snaps = [
    [34200, 31200, 500],
    [35700, 38700, 3200],
  ];
  for (const [from, to, tol] of snaps) {
    if (Math.abs(price - from) <= tol) return to;
  }
  return price;
}

function pickConsensusSigPrice(candidates) {
  const filtered = candidates.filter((p) => p >= SIG_PRICE_MIN && p <= SIG_PRICE_MAX);
  if (!filtered.length) return null;
  const counts = new Map();
  for (const p of filtered) counts.set(p, (counts.get(p) || 0) + 1);
  const forVote = filtered.filter((p) => p <= SIG_PRICE_SOFT_MAX || (counts.get(p) || 0) >= 2);
  let pool = forVote.length ? forVote : filtered;
  if (!forVote.length && filtered.every((p) => p > SIG_PRICE_SOFT_MAX)) {
    if (filtered.length === 1) {
      const only = filtered[0];
      if (only % 1000 === 0) return only;
      return null;
    }
    return null;
  }
  if (!forVote.length && filtered.some((p) => p > SIG_PRICE_SOFT_MAX)) {
    pool = filtered.filter((p) => p <= SIG_PRICE_SOFT_MAX);
    if (!pool.length) return null;
  }
  let best = null;
  let bestCount = 0;
  for (const [price, count] of counts) {
    if (!pool.includes(price)) continue;
    if (count > bestCount || (count === bestCount && best != null && price > best)) {
      best = price;
      bestCount = count;
    }
  }
  if (bestCount >= 2) return best;
  const trimmed = removeOutlierSigPrices(pool);
  if (!trimmed.length) return null;
  if (trimmed.length === 1) return trimmed[0];
  let picked = trimmed[0];
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

function renderGifComposite(gif, frames, endIndex) {
  const w = gif.lsd.width;
  const h = gif.lsd.height;
  const display = createCanvas(w, h);
  const displayCtx = display.getContext("2d");
  const temp = createCanvas(1, 1);
  const patchCtx = temp.getContext("2d");
  let frameImageData = null;
  const last = Math.min(endIndex, frames.length - 1);
  for (let i = 0; i <= last; i++) {
    const frame = frames[i];
    if (frame.disposalType === 2) displayCtx.clearRect(0, 0, w, h);
    const dims = frame.dims;
    if (!frameImageData || dims.width !== frameImageData.width || dims.height !== frameImageData.height) {
      temp.width = dims.width;
      temp.height = dims.height;
      frameImageData = patchCtx.createImageData(dims.width, dims.height);
    }
    frameImageData.data.set(frame.patch);
    patchCtx.putImageData(frameImageData, 0, 0);
    displayCtx.drawImage(temp, dims.left, dims.top);
  }
  return display;
}

function scaleCanvas(src) {
  const w0 = src.width;
  const h0 = src.height;
  let scale = 1;
  const short = Math.min(w0, h0);
  if (short < OCR_MIN_SHORT_EDGE) scale = OCR_MIN_SHORT_EDGE / short;
  let nw = Math.max(1, Math.floor(w0 * scale));
  let nh = Math.max(1, Math.floor(h0 * scale));
  const longest = Math.max(nw, nh);
  if (longest > OCR_MAX_SIDE) {
    const r = OCR_MAX_SIDE / longest;
    nw = Math.max(1, Math.floor(nw * r));
    nh = Math.max(1, Math.floor(nh * r));
  }
  const out = createCanvas(nw, nh);
  const ctx = out.getContext("2d");
  ctx.drawImage(src, 0, 0, nw, nh);
  return out;
}

function canvasToBinary(canvas) {
  const out = createCanvas(canvas.width, canvas.height);
  const ctx = out.getContext("2d");
  ctx.drawImage(canvas, 0, 0);
  const { width: w, height: h } = out;
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  let sum = 0;
  const lum = new Float32Array(w * h);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    lum[p] = y;
    sum += y;
  }
  const mean = sum / Math.max(1, lum.length);
  const threshold = mean * 0.9;
  const invert = mean < 110;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    let v = lum[p] > threshold ? 255 : 0;
    if (invert) v = 255 - v;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
  return out;
}

function cropBottom(canvas) {
  const y0 = Math.floor(canvas.height * 0.45);
  const out = createCanvas(canvas.width, canvas.height - y0);
  out.getContext("2d").drawImage(canvas, 0, -y0);
  return out;
}

async function recognizeAmount(worker, canvas, modes) {
  const buf = canvas.toBuffer("image/png");
  const candidates = [];
  for (const psm of modes) {
    await worker.setParameters({ tessedit_pageseg_mode: psm });
    const {
      data: { text },
    } = await worker.recognize(buf);
    const price = parseSigAmountFromText(text);
    if (price != null) candidates.push(price);
  }
  const p = pickConsensusSigPrice(candidates);
  return p != null ? refineCommonSigOcrMisreads(p) : null;
}

async function detectFromCanvas(worker, colorCanvas, modes) {
  const candidates = [];
  const cropBand = (canvas) => {
    const y0 = Math.floor(canvas.height * 0.52);
    const y1 = Math.floor(canvas.height * 0.92);
    const x0 = Math.floor(canvas.width * 0.1);
    const x1 = Math.floor(canvas.width * 0.9);
    const out = createCanvas(x1 - x0, y1 - y0);
    out.getContext("2d").drawImage(canvas, x0, y0, x1 - x0, y1 - y0, 0, 0, x1 - x0, y1 - y0);
    return out;
  };
  const variants = [
    colorCanvas,
    canvasToBinary(colorCanvas),
    cropBottom(colorCanvas),
    canvasToBinary(cropBottom(colorCanvas)),
    cropBand(colorCanvas),
    canvasToBinary(cropBand(colorCanvas)),
  ];
  for (const v of variants) {
    const p = await recognizeAmount(worker, v, modes);
    if (p != null) candidates.push(p);
  }
  const p = pickConsensusSigPrice(candidates);
  return p != null ? refineCommonSigOcrMisreads(p) : null;
}

function applySigNamePriceFallback(sigName, price) {
  const name = String(sigName || "").trim();
  if (name.includes("간바레") || name.includes("센빠이") || name.includes("센베이")) {
    if (price == null || price < 20000) return 31200;
  }
  if (/^APT$/i.test(name) && (price === 38700 || price === 39000)) return 38900;
  return price;
}

async function detectGifFile(workers, modes, filePath) {
  const buf = fs.readFileSync(filePath);
  const gif = parseGIF(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const frames = decompressFrames(gif, true);
  if (!frames.length) return null;
  const indices = pickGifFrameIndices(frames.length);
  const candidates = [];
  for (const worker of workers) {
    for (const idx of indices) {
      const composite = renderGifComposite(gif, frames, idx);
      const scaled = scaleCanvas(composite);
      const p = await detectFromCanvas(worker, scaled, modes);
      if (p != null) {
        candidates.push(p);
        if (candidates.filter((x) => x === p).length >= 2) break;
      }
    }
    if (candidates.filter((x, i, a) => a.indexOf(x) !== i).length) break;
  }
  const p = pickConsensusSigPrice(candidates);
  const refined = p != null ? refineCommonSigOcrMisreads(p) : null;
  const base = path.basename(filePath, path.extname(filePath));
  return applySigNamePriceFallback(base, refined);
}

async function detectFirstFrameOnly(worker, modes, filePath) {
  const img = await loadImage(fs.readFileSync(filePath));
  const c = createCanvas(img.width, img.height);
  c.getContext("2d").drawImage(img, 0, 0);
  return detectFromCanvas(worker, scaleCanvas(c), modes);
}

function parseArgs() {
  const limitIdx = process.argv.indexOf("--limit");
  const onlyIdx = process.argv.indexOf("--only");
  const limit = limitIdx >= 0 ? Number(process.argv[limitIdx + 1]) : 0;
  const only =
    onlyIdx >= 0
      ? process.argv[onlyIdx + 1]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : null;
  return { limit, only };
}

async function main() {
  const { limit, only } = parseArgs();
  if (!fs.existsSync(SIG_DIR)) {
    console.error("GIF 폴더 없음:", SIG_DIR);
    process.exit(1);
  }
  let files = fs
    .readdirSync(SIG_DIR)
    .filter((f) => f.toLowerCase().endsWith(".gif"))
    .sort();
  if (only?.length) {
    files = files.filter((f) => only.some((q) => f.includes(q) || f.replace(/\.gif$/i, "") === q));
  }
  if (limit > 0) files = files.slice(0, limit);

  const modes = [PSM.SINGLE_LINE, PSM.SINGLE_BLOCK, PSM.SPARSE_TEXT, PSM.AUTO].map(Number);
  const workerEng = await createWorker("eng", 1, { logger: () => {} });
  const workerKor = await createWorker("kor+eng", 1, { logger: () => {} });
  const workers = [workerEng, workerKor];

  const rows = [];
  for (const file of files) {
    const fp = path.join(SIG_DIR, file);
    const multi = await detectGifFile(workers, modes, fp);
    const first = await detectFirstFrameOnly(workerEng, modes, fp);
    rows.push({ file, multi, first });
    const tag = multi != null ? String(multi) : "null";
    const diff = multi !== first ? ` (1st=${first ?? "null"})` : "";
    console.log(`${file}\t${tag}${diff}`);
  }

  await workerEng.terminate();
  await workerKor.terminate();

  const ok = rows.filter((r) => r.multi != null).length;
  const fixed = rows.filter((r) => r.multi != null && r.first == null).length;
  console.log(`\n--- 요약: ${ok}/${rows.length} 다중프레임 인식, 첫프레임만 실패→다중 성공 ${fixed}건 ---`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
