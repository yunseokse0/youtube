/**
 * 타이머 디자인 JPG → PNG(투명 배경) 변환
 * usage: node scripts/prepare-timer-design-assets.mjs
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = 480;
const COUNTDOWN_COL = 1300;
const COUNTDOWN_ROW = 1500;

function applyWhiteTransparent(raw, channels, threshold = 245) {
  if (channels < 4) throw new Error("expected RGBA");
  for (let i = 0; i < raw.length; i += channels) {
    const r = raw[i];
    const g = raw[i + 1];
    const b = raw[i + 2];
    if (r >= threshold && g >= threshold && b >= threshold) {
      raw[i + 3] = 0;
    }
  }
}

async function writePngFromJpgExtract(inputRel, outputRel, extract, resize = OUT) {
  const input = path.join(ROOT, inputRel);
  const output = path.join(ROOT, outputRel);
  if (!fs.existsSync(input)) {
    console.warn("skip missing", input);
    return;
  }
  let pipeline = sharp(input);
  if (extract) pipeline = pipeline.extract(extract);
  const resized = await pipeline
    .resize(resize, resize, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const buf = Buffer.from(resized.data);
  applyWhiteTransparent(buf, resized.info.channels, 245);

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

await writePngFromJpgExtract(
  "public/assets/timer-designs/countdown-pack/5d552899-246b-45a1-a27f-470be0c7bd80.jpg",
  "public/assets/timer-designs/countdown-ring-frame.png",
  { left: 5 * COUNTDOWN_COL, top: COUNTDOWN_ROW, width: COUNTDOWN_COL, height: COUNTDOWN_ROW }
);

await writePngFromJpgExtract(
  "public/assets/timer-designs/infographic/OGFA250.jpg",
  "public/assets/timer-designs/speedometer-frame.png",
  { left: 95, top: 780, width: 420, height: 420 }
);
