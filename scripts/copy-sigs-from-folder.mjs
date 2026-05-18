/**
 * PC 폴더 → public/images/sigs/from-drive/ 복사 (Git push 후 관리자 「저장소」·「신규만 추가」)
 *
 * 사용:
 *   npm run sig:import -- "D:\siggif"
 *   npm run sig:import:new -- "D:\siggif"     ← 이미 있는 파일명은 건너뜀
 *   node scripts/copy-sigs-from-folder.mjs --new-only "D:\siggif"
 */
import fs from "fs/promises";
import path from "path";

const argv = process.argv.slice(2);
const newOnly = argv.includes("--new-only") || argv.includes("-n");
const srcDir = argv.find((a) => !a.startsWith("-"));
const destDir = path.join(process.cwd(), "public", "images", "sigs", "from-drive");
const ALLOWED = /\.(gif|png|webp|jpe?g)$/i;

if (!srcDir || srcDir === "-h" || srcDir === "--help") {
  console.error('사용법: node scripts/copy-sigs-from-folder.mjs [--new-only] "<원본_폴더_경로>"');
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
let copied = 0;
let skipped = 0;
for (const name of names) {
  if (!ALLOWED.test(name)) continue;
  const from = path.join(absSrc, name);
  const st = await fs.stat(from);
  if (!st.isFile()) continue;
  const to = path.join(destDir, name);
  if (newOnly) {
    try {
      await fs.access(to);
      skipped += 1;
      console.log("건너뜀(이미 있음):", name);
      continue;
    } catch {
      /* copy */
    }
  }
  await fs.copyFile(from, to);
  copied += 1;
  console.log("복사:", name);
}
console.log(
  `완료: ${copied}개 복사, ${skipped}개 건너뜀 → ${path.relative(process.cwd(), destDir)}${newOnly ? " (--new-only)" : ""}`
);
if (copied === 0 && skipped === 0) {
  console.warn("복사할 이미지가 없습니다. .gif .png .webp .jpg 를 확인하세요.");
}
