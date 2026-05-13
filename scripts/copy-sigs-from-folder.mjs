/**
 * Google Drive 등에서 받은 폴더의 GIF를 public/images/sigs/from-drive/ 로 복사합니다.
 * 이후 git add / commit / push 하면 Render 등 배포본에 포함됩니다.
 *
 * 사용:
 *   node scripts/copy-sigs-from-folder.mjs "C:\Users\me\Downloads\siggif"
 *   npm run sig:import -- "D:\path\to\folder"
 */
import fs from "fs/promises";
import path from "path";

const srcDir = process.argv[2];
const destDir = path.join(process.cwd(), "public", "images", "sigs", "from-drive");

if (!srcDir || srcDir === "-h" || srcDir === "--help") {
  console.error('사용법: node scripts/copy-sigs-from-folder.mjs "<원본_폴더_경로>"');
  process.exit(1);
}

const absSrc = path.resolve(srcDir);
let stat;
try {
  stat = await fs.stat(absSrc);
} catch {
  console.error("폴더를 찾을 수 없습니다:", absSrc);
  process.exit(1);
}
if (!stat.isDirectory()) {
  console.error("디렉터리가 아닙니다:", absSrc);
  process.exit(1);
}

await fs.mkdir(destDir, { recursive: true });
const names = await fs.readdir(absSrc);
let n = 0;
for (const name of names) {
  if (!/\.gif$/i.test(name)) continue;
  const from = path.join(absSrc, name);
  const st = await fs.stat(from);
  if (!st.isFile()) continue;
  const to = path.join(destDir, name);
  await fs.copyFile(from, to);
  n += 1;
  console.log("복사:", name);
}
console.log(`완료: ${n}개 GIF → ${path.relative(process.cwd(), destDir)}`);
if (n === 0) {
  console.warn("GIF가 없습니다. 폴더 안 파일 확장자가 .gif 인지 확인하세요.");
}
