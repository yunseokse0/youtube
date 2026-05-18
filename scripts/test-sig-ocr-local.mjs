/**
 * 로컬 from-drive GIF 다중 프레임 OCR 스모크 테스트.
 * 사용: node scripts/test-sig-ocr-local.mjs [--limit N] [--only name1,name2]
 */
import fs from "fs";
import path from "path";
import {
  DEFAULT_SIG_GIF_DIR,
  createLocalSigOcrWorkers,
  detectGifFile,
} from "./lib/local-sig-ocr.mjs";

const SIG_DIR = DEFAULT_SIG_GIF_DIR;

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

  const { workers, modes, terminate } = await createLocalSigOcrWorkers();
  const rows = [];
  try {
    for (const file of files) {
      const fp = path.join(SIG_DIR, file);
      const multi = await detectGifFile(workers, modes, fp);
      rows.push({ file, multi });
      console.log(`${file}\t${multi != null ? multi : "null"}`);
    }
  } finally {
    await terminate();
  }

  const ok = rows.filter((r) => r.multi != null).length;
  console.log(`\n--- 요약: ${ok}/${rows.length} 다중프레임 인식 ---`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
