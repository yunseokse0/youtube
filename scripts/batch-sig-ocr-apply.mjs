/**
 * 로컬 PC에서 시그 GIF OCR → JSON 저장 → (선택) 운영 서버 sigInventory 가격 반영
 *
 * 1) OCR만 (결과 JSON)
 *    node scripts/batch-sig-ocr-apply.mjs
 *    npm run sig:ocr-batch
 *
 * 2) 서버에 반영 (관리자 로그인 쿠키 필요)
 *    node scripts/batch-sig-ocr-apply.mjs --apply --base-url https://youtube-ovvv.onrender.com --user finalent --cookie "sb_user=..."
 *
 * 3) JSON 수정 후 재반영
 *    node scripts/batch-sig-ocr-apply.mjs --apply --from-json sig-ocr-results.json --base-url ... --cookie ...
 */
import fs from "fs";
import path from "path";
import {
  DEFAULT_SIG_GIF_DIR,
  applySigNamePriceFallback,
  bundledFromDriveImageUrl,
  createLocalSigOcrWorkers,
  detectGifFile,
  matchSigInventoryItemByFileName,
  resolveOcrSpeed,
  sigImageFileBaseName,
} from "./lib/local-sig-ocr.mjs";

const ONE_SHOT_SIG_ID = "sig_one_shot";
const DEFAULT_OUT = path.join(process.cwd(), "sig-ocr-results.json");

function parseArgs(argv) {
  const get = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? String(argv[i + 1] || "").trim() : "";
  };
  const has = (flag) => argv.includes(flag);
  return {
    dir: get("--dir") || DEFAULT_SIG_GIF_DIR,
    limit: Number(get("--limit")) || 0,
    only: get("--only")
      ? get("--only")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : null,
    out: get("--out") || DEFAULT_OUT,
    apply: has("--apply"),
    fromJson: get("--from-json"),
    baseUrl: (
      get("--base-url") ||
      get("--url") ||
      process.env.SIG_OCR_BASE_URL ||
      "https://youtube-5g1a.onrender.com"
    ).replace(/\/$/, ""),
    user: get("--user") || get("-u") || process.env.SIG_OCR_USER || "finalent",
    cookie: get("--cookie") || process.env.SIG_OCR_COOKIE || "",
    setImageUrl: !has("--no-set-image-url"),
    dryRun: has("--dry-run") || (!has("--apply") && !get("--from-json")),
    speed: resolveOcrSpeed(argv),
  };
}

function listGifFiles(dir, limit, only) {
  if (!fs.existsSync(dir)) throw new Error(`GIF 폴더 없음: ${dir}`);
  let files = fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".gif"))
    .sort();
  if (only?.length) {
    files = files.filter((f) =>
      only.some((q) => f.includes(q) || f.replace(/\.gif$/i, "") === q)
    );
  }
  if (limit > 0) files = files.slice(0, limit);
  return files;
}

async function fetchState(baseUrl, user, cookie) {
  const url = `${baseUrl}/api/state?u=${encodeURIComponent(user)}`;
  const headers = { Accept: "application/json" };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) throw new Error(`GET /api/state ${res.status}`);
  return res.json();
}

async function postSigInventory(baseUrl, user, cookie, sigInventory) {
  const url = `${baseUrl}/api/state?u=${encodeURIComponent(user)}`;
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ sigInventory, updatedAt: Date.now() }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`POST /api/state ${res.status}: ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return { ok: true };
  }
}

async function runOcr(dir, limit, only, speed) {
  const files = listGifFiles(dir, limit, only);
  const { workers, modes, terminate } = await createLocalSigOcrWorkers(speed);
  const rows = [];
  try {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fp = path.join(dir, file);
      process.stderr.write(`[${i + 1}/${files.length}] OCR ${file}…\r`);
      const price = await detectGifFile(workers, modes, fp, speed);
      rows.push({
        file,
        imageUrl: bundledFromDriveImageUrl(file),
        price,
        status: price != null ? "ok" : "fail",
      });
    }
    process.stderr.write("\n");
  } finally {
    await terminate();
  }
  return rows;
}

function mergeRowsWithInventory(rows, inventory, setImageUrl) {
  const items = (inventory || []).filter((x) => x.id !== ONE_SHOT_SIG_ID);
  const usedIds = new Set();
  const merged = [];

  for (const row of rows) {
    const hit = matchSigInventoryItemByFileName(items, row.file);
    if (!hit || usedIds.has(hit.id)) {
      merged.push({
        ...row,
        sigId: hit?.id || null,
        sigName: hit?.name || sigImageFileBaseName(row.file),
        status: hit ? "duplicate_match" : "no_match",
      });
      continue;
    }
    usedIds.add(hit.id);
    const name = hit.name || sigImageFileBaseName(row.file);
    const price =
      row.price != null ? applySigNamePriceFallback(name, row.price) : null;
    merged.push({
      ...row,
      sigId: hit.id,
      sigName: name,
      previousPrice: hit.price,
      price,
      status: price != null ? "ok" : "fail",
      applyPrice: price != null,
      applyImageUrl: setImageUrl,
    });
  }
  return { merged, items, usedIds };
}

function buildUpdatedInventory(items, merged, setImageUrl) {
  const byId = new Map(merged.filter((r) => r.sigId && r.applyPrice !== false).map((r) => [r.sigId, r]));
  return items.map((item) => {
    const row = byId.get(item.id);
    if (!row) return item;
    const next = { ...item };
    if (row.price != null) next.price = row.price;
    if (setImageUrl && row.imageUrl) next.imageUrl = row.imageUrl;
    return next;
  });
}

async function main() {
  const args = parseArgs(process.argv);
  let rows;

  if (args.fromJson) {
    const raw = JSON.parse(fs.readFileSync(args.fromJson, "utf8"));
    rows = Array.isArray(raw) ? raw : raw.results || [];
    console.log(`JSON에서 ${rows.length}건 로드: ${args.fromJson}`);
  } else {
    console.log(`로컬 OCR 시작: ${args.dir} (모드=${args.speed})`);
    rows = await runOcr(args.dir, args.limit, args.only, args.speed);
    const ok = rows.filter((r) => r.price != null).length;
    console.log(`OCR 완료: 성공 ${ok} / ${rows.length}`);
  }

  let payload = {
    generatedAt: new Date().toISOString(),
    gifDir: args.dir,
    results: rows,
  };

  if (args.baseUrl) {
    console.log(`서버 상태 조회: ${args.baseUrl} (u=${args.user})`);
    const state = await fetchState(args.baseUrl, args.user, args.cookie);
    const inventory = state.sigInventory || [];
    const { merged, items } = mergeRowsWithInventory(rows, inventory, args.setImageUrl);
    payload = { ...payload, results: merged, userId: args.user, baseUrl: args.baseUrl };

    const applyable = merged.filter((r) => r.sigId && r.price != null);
    const noMatch = merged.filter((r) => !r.sigId || r.status === "no_match");
    console.log(`매칭: 적용 가능 ${applyable.length}건, 미매칭 ${noMatch.length}건`);

    if (args.apply && !args.dryRun) {
      if (!args.cookie) {
        console.error(
          "오류: --apply 시 관리자 쿠키가 필요합니다.\n" +
            "  브라우저 F12 → Application → Cookies → sb_user 값을\n" +
            '  --cookie "sb_user=..." 또는 환경변수 SIG_OCR_COOKIE 로 넘기세요.'
        );
        process.exit(1);
      }
      const nextInventory = buildUpdatedInventory(items, merged, args.setImageUrl);
      const fullInventory = (inventory || []).map((item) => {
        if (item.id === ONE_SHOT_SIG_ID) return item;
        const updated = nextInventory.find((x) => x.id === item.id);
        return updated || item;
      });
      console.log(`서버 반영 중… (${applyable.length}건 가격 갱신)`);
      const res = await postSigInventory(args.baseUrl, args.user, args.cookie, fullInventory);
      payload.appliedAt = new Date().toISOString();
      payload.serverResponse = res;
      console.log("서버 저장 완료.", res.updatedAt ? `updatedAt=${res.updatedAt}` : "");
    } else if (args.apply) {
      console.log("--dry-run: 서버 POST 생략 (JSON만 저장)");
    }
  }

  fs.writeFileSync(args.out, JSON.stringify(payload, null, 2), "utf8");
  console.log(`결과 저장: ${args.out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
