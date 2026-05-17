/**
 * GIF 프레임별 OCR 원문·후보 덤프
 * node scripts/debug-sig-prices.mjs 고민중독
 */
import fs from "fs";
import path from "path";
import { createCanvas } from "canvas";
import { createWorker, PSM } from "tesseract.js";
import { decompressFrames, parseGIF } from "gifuct-js";

const name = process.argv[2] || "고민중독";
const fp = path.join(process.cwd(), "public/images/sigs/from-drive", name.endsWith(".gif") ? name : `${name}.gif`);
const buf = fs.readFileSync(fp);
const gif = parseGIF(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const frames = decompressFrames(gif, true);
const w = gif.lsd.width;
const h = gif.lsd.height;

function render(end) {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");
  const t = createCanvas(1, 1);
  const pctx = t.getContext("2d");
  let id = null;
  for (let i = 0; i <= end; i++) {
    const f = frames[i];
    if (f.disposalType === 2) ctx.clearRect(0, 0, w, h);
    const d = f.dims;
    if (!id || d.width !== id.width) {
      t.width = d.width;
      t.height = d.height;
      id = pctx.createImageData(d.width, d.height);
    }
    id.data.set(f.patch);
    pctx.putImageData(id, 0, 0);
    ctx.drawImage(t, d.left, d.top);
  }
  return c;
}

const worker = await createWorker("kor+eng", 1, { logger: () => {} });
const modes = [PSM.SINGLE_LINE, PSM.SINGLE_BLOCK, PSM.SPARSE_TEXT].map(Number);

const target = Number(process.env.TARGET || 0);

for (let idx = 0; idx < frames.length; idx += 2) {
  const c = render(idx);
  const y0 = Math.floor(h * 0.52);
  const crop = createCanvas(w, h - y0);
  crop.getContext("2d").drawImage(c, 0, -y0);
  const sc = 480 / Math.min(crop.width, crop.height);
  const up = createCanvas(Math.floor(crop.width * sc), Math.floor(crop.height * sc));
  up.getContext("2d").drawImage(crop, 0, 0, up.width, up.height);
  await worker.setParameters({ tessedit_pageseg_mode: modes[0] });
  const {
    data: { text },
  } = await worker.recognize(up.toBuffer("image/png"));
  const digits = text.match(/\d[\d,.\s]{2,12}/g) || [];
  const flat = text.replace(/[^\d]/g, "");
  const hitTarget = target && (flat.includes(String(target)) || text.includes("만"));
  if (digits.length && (hitTarget || !target)) {
    console.log(`frame ${idx}:`, digits.join(" | "), hitTarget ? "***" : "", "\n ", text.replace(/\s+/g, " ").slice(0, 120));
  }
}
await worker.terminate();
