import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const src = path.join(
  process.env.USERPROFILE || "",
  ".cursor/projects/c-Users-DIN-STUDIO-Projects-youtube/assets",
  "c__Users_DIN-STUDIO_AppData_Roaming_Cursor_User_workspaceStorage_f429b49b8cf26b6ec91e6c921c71927c_images_DIN__-fee58f2b-1f14-4c12-857b-2f07ec0f9ee4.png"
);

const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

/**
 * 원본: 검정 모노그램 + 밝은 배경
 * 파비콘: 검정 배경 + 밝은 실버 모노그램 (다크 UI·브라우저 탭 시인성)
 */
for (let i = 0; i < data.length; i += 4) {
  const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  if (lum < 128) {
    data[i] = 228;
    data[i + 1] = 228;
    data[i + 2] = 232;
    data[i + 3] = 255;
  } else {
    data[i] = 0;
    data[i + 1] = 0;
    data[i + 2] = 0;
    data[i + 3] = 255;
  }
}

const markPng = await sharp(data, {
  raw: { width: info.width, height: info.height, channels: 4 },
})
  .png()
  .toBuffer();

async function makeSquare(size) {
  return sharp(markPng)
    .resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    })
    .png()
    .toBuffer();
}

const appDir = path.join(root, "src", "app");
const publicDir = path.join(root, "public");

const icon512 = await makeSquare(512);
const icon180 = await makeSquare(180);
const icon192 = await makeSquare(192);
const icon32 = await makeSquare(32);

fs.writeFileSync(path.join(appDir, "icon.png"), icon512);
fs.writeFileSync(path.join(appDir, "apple-icon.png"), icon180);
fs.writeFileSync(path.join(publicDir, "icon.png"), icon512);
fs.writeFileSync(path.join(publicDir, "apple-icon.png"), icon180);
fs.writeFileSync(path.join(publicDir, "icon-192.png"), icon192);
fs.writeFileSync(path.join(publicDir, "icon-512.png"), icon512);
fs.writeFileSync(path.join(publicDir, "favicon.ico"), icon32);

console.log("favicon assets written (silver DIN on black)");
