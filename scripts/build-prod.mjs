#!/usr/bin/env node
/**
 * EC2·저메모리 서버용 프로덕션 빌드.
 * - NODE_OPTIONS 힙 상향
 * - LOW_MEMORY_BUILD=1 → next.config worker 1개
 * - NEXT_BUILD_DIR=.next-staging → 기존 .next 유지한 채 스테이징 빌드(deploy-on-ec2.sh)
 * - PM2_STOP_BEFORE_BUILD=1 → 빌드 전 pm2 stop (OOM 시에만)
 * - PM2_APP + 스테이징 없음 → 구 방식(빌드 전 stop, 빌드 후 restart)
 */
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

const heapMb = String(process.env.NODE_HEAP_MB || "2048").replace(/[^\d]/g, "") || "2048";
const pm2App = String(process.env.PM2_APP || "").trim();
const stagingDir = String(process.env.NEXT_BUILD_DIR || "").trim();
const stopBeforeBuild =
  process.env.PM2_STOP_BEFORE_BUILD === "1" && Boolean(pm2App);
const shell = process.platform === "win32";

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    shell,
    ...opts,
  });
  if (r.error) {
    console.error(r.error.message);
    process.exit(1);
  }
  return r.status ?? 1;
}

console.log(
  `[build:prod] NODE heap ${heapMb}MB · LOW_MEMORY_BUILD=1` +
    (stagingDir ? ` · distDir=${stagingDir}` : "")
);

const legacyInPlace = Boolean(pm2App) && !stagingDir;
if (legacyInPlace || stopBeforeBuild) {
  console.log(`[build:prod] pm2 stop ${pm2App} (RAM 확보)`);
  run("pm2", ["stop", pm2App], { stdio: "inherit" });
}

/** 라우트 삭제 후 남은 types 캐시가 타입 검사 실패하는 것 방지 — 스테이징 빌드 중 실행 중 .next/types 는 건드리지 않음 */
const cleanDirs = stagingDir
  ? [...new Set([stagingDir, ".next-staging"].filter(Boolean))]
  : [".next-staging", ".next/types"];
for (const dir of cleanDirs) {
  const target = path.resolve(dir);
  console.log(`[build:prod] clean ${dir}`);
  rmSync(target, { recursive: true, force: true });
}

const env = {
  ...process.env,
  NODE_OPTIONS: `--max-old-space-size=${heapMb}`,
  LOW_MEMORY_BUILD: "1",
  ...(stagingDir ? { NEXT_BUILD_DIR: stagingDir, NEXT_USE_STAGING_DIST: "1" } : {}),
};

const code = run("npx", ["next", "build"], { env });
if (code !== 0) {
  console.error(
    "\n[build:prod] 실패 — 스왑 미설정이면: sudo bash deploy/ec2-setup-swap.sh\n" +
      "  또는 NODE_HEAP_MB=1536 PM2_STOP_BEFORE_BUILD=1 npm run build:prod\n" +
      "  또는 PC에서 npm run build 후 .next만 scp (deploy/EC2-저메모리-빌드.md)\n" +
      "  라우트 삭제 후 빌드 실패 시: rm -rf .next-staging .next && npm run build:prod\n" +
      "  deploy/deploy-on-ec2.sh 는 스테이징 빌드·실패 시 기존 .next 유지합니다.\n"
  );
  if (pm2App && (legacyInPlace || stopBeforeBuild)) {
    console.warn(`[build:prod] pm2 restart ${pm2App} (이전 .next 가 남아 있을 때만 정상)`);
    run("pm2", ["restart", pm2App], { stdio: "inherit" });
  }
  process.exit(code);
}

if (legacyInPlace) {
  console.log(`[build:prod] pm2 restart ${pm2App}`);
  const restartCode = run("pm2", ["restart", pm2App], { stdio: "inherit" });
  if (restartCode !== 0) {
    console.warn(`[build:prod] pm2 restart 실패 — 서버에서 pm2 status / pm2 logs ${pm2App} 확인`);
  }
} else if (stagingDir) {
  console.log(`[build:prod] 스테이징 완료 (${stagingDir}) — deploy 스크립트에서 .next 교체·pm2 재기동`);
}

console.log("[build:prod] 완료");
