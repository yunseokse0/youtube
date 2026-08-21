/**
 * 엑셀표 장식 프레임 JPG → PNG(투명 중앙) 변환
 * usage: node scripts/prepare-excel-table-frames.mjs
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT_W = 920;
const OUT_H = 680;

/** 밝은 배경·체크무늬(JPEG flatten)을 투명 처리 */
function applyBackgroundTransparent(raw, channels, opts = {}) {
  if (channels < 4) throw new Error("expected RGBA");
  const threshold = opts.threshold ?? 238;
  const grayThreshold = opts.grayThreshold ?? 175;
  for (let i = 0; i < raw.length; i += channels) {
    const r = raw[i];
    const g = raw[i + 1];
    const b = raw[i + 2];
    const lum = (r + g + b) / 3;
    const neutral = Math.abs(r - g) < 18 && Math.abs(g - b) < 18;
    if (r >= threshold && g >= threshold && b >= threshold) {
      raw[i + 3] = 0;
      continue;
    }
    if (opts.includeLightGray && neutral && lum >= grayThreshold) {
      raw[i + 3] = 0;
    }
  }
}

async function convertFrame(inputRel, outputRel, opts = {}) {
  const input = path.join(ROOT, inputRel);
  const output = path.join(ROOT, outputRel);
  if (!fs.existsSync(input)) {
    console.warn("skip missing", input);
    return;
  }
  const resized = await sharp(input)
    .resize(OUT_W, OUT_H, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const buf = Buffer.from(resized.data);
  applyBackgroundTransparent(buf, resized.info.channels, opts);

  fs.mkdirSync(path.dirname(output), { recursive: true });
  await sharp(buf, {
    raw: {
      width: resized.info.width,
      height: resized.info.height,
      channels: resized.info.channels,
    },
  })
    .png({ compressionLevel: 9 })
    .toFile(output);

  const stat = fs.statSync(output);
  console.log("wrote", outputRel, `${Math.round(stat.size / 1024)}KB`);
}

await convertFrame(
  "public/assets/excel-frames/golden/2144527.jpg",
  "public/assets/excel-frames/golden-frame.png",
  { threshold: 235 }
);
await convertFrame(
  "public/assets/excel-frames/candy-canes/228_Q2VuZHlfTmV3LTAx.jpg",
  "public/assets/excel-frames/candy-canes-frame.png",
  { threshold: 240, includeLightGray: true, grayThreshold: 170 }
);
await convertFrame(
  "public/assets/excel-frames/holographic/3130fc03-95ad-4f32-8fd1-35786d83cba4.jpg",
  "public/assets/excel-frames/holographic-frame.png",
  { threshold: 240, includeLightGray: true, grayThreshold: 170 }
);
