#!/usr/bin/env node
/**
 * deploy-ec2.mjs  ·  윈도우 로컬 → EC2 DIN Studio Overlay (ubuntu@3.37.127.90) 한방 배포
 * -----------------------------------------------------------------------------------
 * 동작:
 *   1. ssh ubuntu@3.37.127.90 로 접속 (SSH 개인키는 로컬 사용자 기본 ~/.ssh/id_rsa 사용 · 미리 ssh-add 등록 가정)
 *   2. 원격 서버에 scripts/deploy-youtube.sh 를 stdin 으로 pipe → bash -s 로 실행
 *   3. 원격 stdout/stderr 를 그대로 로컬 콘솔에 실시간 출력
 *   4. 최종 exit code 전파 (0 = 성공 / 10 = build 실패 / 20 = health 불통)
 *
 * 사전 준비 (최초 1회):
 *   ① 로컬 윈도우에서 SSH 개인키 등록:
 *       Start-Service ssh-agent ; ssh-add $env:USERPROFILE\.ssh\id_rsa
 *   ② 접속 테스트 (최초 1회 host key 등록):
 *       ssh ubuntu@3.37.127.90 echo "hello"
 *
 * 실행:
 *   node scripts/deploy-ec2.mjs              # 기본값: ubuntu@3.37.127.90  / ~/youtube
 *   node scripts/deploy-ec2.mjs --dry-run    # 실제 실행 없이 bash 커맨드만 출력
 *   DEPLOY_DIR=/opt/youtube node scripts/deploy-ec2.mjs
 *   SSH_HOST=ec2-user@13.125.221.195 node scripts/deploy-ec2.mjs  # DIN허브 서버용
 * -----------------------------------------------------------------------------------
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const SSH_HOST = process.env.SSH_HOST || "ubuntu@3.37.127.90";
const DEPLOY_DIR = process.env.DEPLOY_DIR || "$HOME/youtube";
const DRY_RUN = process.argv.slice(2).includes("--dry-run");
const DEPLOY_SCRIPT_PATH = path.join(REPO_ROOT, "scripts", "deploy-youtube.sh");

if (!fs.existsSync(DEPLOY_SCRIPT_PATH)) {
  console.error("❌ deploy-youtube.sh 를 찾을 수 없습니다:", DEPLOY_SCRIPT_PATH);
  process.exit(3);
}

const deployScript = fs.readFileSync(DEPLOY_SCRIPT_PATH, "utf-8");

console.log("");
console.log("================================================================");
console.log("  🚀  DIN Studio Overlay EC2 한방 배포");
console.log("================================================================");
console.log("   SSH 대상 ....... ", SSH_HOST);
console.log("   원격 DEPLOY_DIR : ", DEPLOY_DIR);
console.log("   배포 스크립트 .. : ", path.relative(REPO_ROOT, DEPLOY_SCRIPT_PATH));
console.log("   mode ........... : ", DRY_RUN ? "🧪 DRY-RUN (명령만 출력)" : "✅ 실행 모드");
console.log("================================================================");
console.log("");

const remoteCmd = `DEPLOY_DIR='${DEPLOY_DIR}' bash -s`;

if (DRY_RUN) {
  console.log("=== [dry-run] 실행될 SSH 커맨드 ==================================");
  console.log(`$ ssh ${SSH_HOST} '${remoteCmd}'`);
  console.log("  ← stdin 으로 scripts/deploy-youtube.sh 를 전달");
  console.log("");
  console.log("=== [dry-run] 스크립트 미리보기 (첫 30줄) =======================");
  console.log(deployScript.split("\n").slice(0, 30).join("\n"));
  console.log("  ... 총 ", deployScript.split("\n").length, "줄");
  process.exit(0);
}

const child = spawn("ssh", ["-o", "StrictHostKeyChecking=accept-new", "-o", "ServerAliveInterval=30", SSH_HOST, remoteCmd], {
  stdio: ["pipe", "inherit", "inherit"],
  shell: false,
  env: process.env,
});

child.stdin.setDefaultEncoding("utf-8");
child.stdin.write(deployScript);
child.stdin.end();

child.on("error", (err) => {
  console.error("❌ SSH 실행 실패:", err.message);
  process.exit(4);
});

child.on("exit", (code, signal) => {
  console.log("");
  console.log("================================================================");
  if (code === 0) {
    console.log("  ✅  배포 SUCCESS  (exit 0)");
  } else if (code === 10) {
    console.log("  ❌  Build Failed (exit 10). 기존 서비스는 reload 되지 않고 유지됨");
  } else if (code === 20) {
    console.log("  ⚠️  Health Check Failed (exit 20). 배포는 되었으나 health 불통 → 로그 확인");
  } else {
    console.log(`  ❌  배포 실패 (exit ${code} · signal ${signal || "없음"})`);
  }
  console.log("================================================================");
  process.exit(code ?? 1);
});
