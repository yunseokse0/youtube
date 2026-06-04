#!/usr/bin/env node
/** 로컬 오버레이 점검 허브 URL 출력 */
const port = process.env.PORT || "3000";
const host = process.env.DEV_HOST || "localhost";
const base = `http://${host}:${port}`;
console.log("\n[dev] 오버레이 점검 허브");
console.log(`  ${base}/overlay/dev`);
console.log("\n시작: npm run dev");
console.log("LAN OBS: npm run dev:lan  (0.0.0.0 바인딩)\n");
