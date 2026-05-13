/**
 * 폴더 안의 .gif 를 public/images/sigs/<대상폴더>/ 로 복사합니다.
 *
 * 사용:
 *   node scripts/copy-sigs-from-folder.mjs "C:\path\to\siggif"
 *   node scripts/copy-sigs-from-folder.mjs "C:\path\to\siggif" siggif
 *   npm run sig:import -- "D:\Downloads\siggif"
 *   npm run sig:import:siggif -- "D:\Downloads\siggif"
 */
import fs from "fs/promises";
import path from "path";

const args = process.argv.slice(2);
/** `npm run sig:import:siggif -- "원본"` 한 인자만 넘길 때 대상을 siggif 로 고정 */
if (process.env.npm_lifecycle_event === "sig:import:siggif" && args.length === 1) {
  args.push("siggif");
}
if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
  console.error(
    '사용법: node scripts/copy-sigs-from-folder.mjs "<원본_폴더>" [대상하위폴더]\n' +
      "  대상하위폴더 기본값: from-drive  (예: siggif → public/images/sigs/siggif/)"
  );
  process.exit(1);
}

const srcDir = args[0];
let destSub = args[1] || "from-drive";
if (!/^[a-zA-Z0-9_-]+$/.test(destSub)) {
  console.error("대상 하위 폴더 이름은 영문·숫자·-_ 만 허용:", destSub);
  process.exit(1);
}

const destDir = path.join(process.cwd(), "public", "images", "sigs", destSub);

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
