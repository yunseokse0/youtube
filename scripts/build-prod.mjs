#!/usr/bin/env node
/**
 * EC2·저메모리 서버용 프로덕션 빌드.
 * - NODE_OPTIONS 힙 상향
 * - LOW_MEMORY_BUILD=1 → next.config worker 1개
 * - PM2_APP=youtube 이면 빌드 전 pm2 stop (RAM 확보)
 */
import { spawnSync } from "node:child_process";

const heapMb = String(process.env.NODE_HEAP_MB || "2048").replace(/[^\d]/g, "") || "2048";
const pm2App = String(process.env.PM2_APP || "").trim();
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

console.log(`[build:prod] NODE heap ${heapMb}MB · LOW_MEMORY_BUILD=1`);

if (pm2App) {
  console.log(`[build:prod] pm2 stop ${pm2App} (RAM 확보)`);
  run("pm2", ["stop", pm2App], { stdio: "inherit" });
}

const env = {
  ...process.env,
  NODE_OPTIONS: `--max-old-space-size=${heapMb}`,
  LOW_MEMORY_BUILD: "1",
};

const code = run("npx", ["next", "build"], { env });
if (code !== 0) {
  console.error(
    "\n[build:prod] 실패 — 스왑 미설정이면: sudo bash deploy/ec2-setup-swap.sh\n" +
      "  또는 NODE_HEAP_MB=1536 PM2_APP=youtube npm run build:prod\n" +
      "  또는 PC에서 npm run build 후 .next만 scp (deploy/EC2-저메모리-빌드.md)\n" +
      "  deploy/deploy-on-ec2.sh 는 실패 시 이전 .next 로 자동 복구합니다.\n"
  );
  if (pm2App) {
    console.warn(`[build:prod] pm2 restart ${pm2App} (이전 .next 가 남아 있을 때만 정상)`);
    run("pm2", ["restart", pm2App], { stdio: "inherit" });
  }
  process.exit(code);
}

if (pm2App) {
  console.log(`[build:prod] pm2 restart ${pm2App}`);
  const restartCode = run("pm2", ["restart", pm2App], { stdio: "inherit" });
  if (restartCode !== 0) {
    console.warn(`[build:prod] pm2 restart 실패 — 서버에서 pm2 status / pm2 logs ${pm2App} 확인`);
  }
}

console.log("[build:prod] 완료");
