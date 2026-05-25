#!/usr/bin/env node
/**
 * 오버레이(식사·시그 대전·SSE·데모) 자동 검증 — CI·로컬 공용
 * 사용: npm run verify:overlay
 */
import { spawnSync } from "child_process";

const VITEST_TARGETS = [
  "src/lib/meal-gauge-effects.test.ts",
  "src/lib/meal-gauge-motion.test.ts",
  "src/lib/overlay-dev-hud.test.ts",
  "src/lib/overlay-sse-suppress.test.ts",
  "src/lib/overlay-pull-policy.test.ts",
  "src/lib/overlay-sync-signature.test.ts",
  "src/lib/overlay-amount-display.test.ts",
  "src/lib/sig-match-snapshot.test.ts",
  "src/lib/battle-effects-demo.test.ts",
];

function run(label, command, args) {
  console.log(`\n[verify:overlay] ${label}`);
  const r = spawnSync(command, args, { stdio: "inherit", shell: true, env: process.env });
  if (r.status !== 0) {
    console.error(`[verify:overlay] FAILED: ${label}`);
    process.exit(r.status ?? 1);
  }
}

console.log("[verify:overlay] 오버레이 자동 검증 시작…");

run("unit tests (vitest)", "npx", ["vitest", "run", ...VITEST_TARGETS]);
run("TypeScript", "npm", ["run", "typecheck"]);
run("ESLint", "npm", ["run", "lint"]);

console.log("\n[verify:overlay] 전체 통과 ✓");
console.log("수동 UI: http://localhost:3000/overlay/battle-effects-demo/verify");
console.log("로컬 dev: npm run dev:clean 후 브라우저 Ctrl+Shift+R");
