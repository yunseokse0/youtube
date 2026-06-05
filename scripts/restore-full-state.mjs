#!/usr/bin/env node
/**
 * 관리자 「상태보내기(JSON)」 파일 → 서버 전체 방송 상태 복구
 *
 *   BASE_URL=http://13.124.114.125 USER=finalent node scripts/restore-full-state.mjs state-backup.json
 *   node scripts/restore-full-state.mjs --dry-run .tmp-full-state.json
 */
import fs from "fs/promises";
import path from "path";

const BASE_URL = (
  process.env.SIG_CATALOG_BASE_URL ||
  process.env.BASE_URL ||
  "http://13.124.114.125"
).replace(/\/$/, "");
const USER =
  process.env.SIG_CATALOG_USER ||
  process.env.USER_ID ||
  process.env.USER ||
  "finalent";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const fileArg = args.find((a) => !a.startsWith("--"));

const STATE_KEYS = [
  "members",
  "memberPositions",
  "memberPositionMode",
  "rankPositionLabels",
  "donorRankingsTheme",
  "donorRankingsFullTheme",
  "donorRankingsPresets",
  "donorRankingsPresetId",
  "donors",
  "donorsFormat",
  "contributionLogs",
  "forbiddenWords",
  "missions",
  "sigInventory",
  "sigSoldOutStampUrl",
  "sigSalesMemberPresets",
  "sigSalesExcludedIds",
  "rouletteState",
  "overlayPresets",
  "overlaySettings",
  "sigMatch",
  "sigMatchSettings",
  "mealBattle",
  "mealMatch",
  "mealMatchSettings",
  "generalTimer",
  "matchTimerEnabled",
  "timerDisplayStyles",
  "donorRankingsOverlayConfig",
  "donorRankingsFullOverlayConfig",
  "donationListsOverlayConfig",
  "donationSyncMode",
  "sigRolling",
  "sigRollingMeta",
];

async function main() {
  if (!fileArg) {
    console.error("사용: node scripts/restore-full-state.mjs <state.json>");
    process.exit(1);
  }
  const raw = await fs.readFile(path.resolve(fileArg), "utf8");
  const parsed = JSON.parse(raw);
  const body = { updatedAt: Date.now() };
  for (const k of STATE_KEYS) {
    if (parsed[k] !== undefined) body[k] = parsed[k];
  }
  const summary = [
    body.sigInventory?.length != null ? `시그 ${body.sigInventory.length}` : null,
    body.members?.length != null ? `멤버 ${body.members.length}` : null,
    body.donors?.length != null ? `후원 ${body.donors.length}` : null,
    body.overlayPresets?.length != null ? `프리셋 ${body.overlayPresets.length}` : null,
  ].filter(Boolean);
  console.log(`[restore-full-state] ${path.basename(fileArg)}`);
  console.log(`  복구: ${summary.join(" · ") || "(키 없음)"}`);
  if (dryRun) {
    console.log("  --dry-run: POST 생략");
    return;
  }
  const q = new URLSearchParams({ user: USER, u: USER });
  const res = await fetch(`${BASE_URL}/api/state?${q.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST 실패 HTTP ${res.status}: ${text.slice(0, 400)}`);
  const result = text.trim() ? JSON.parse(text) : {};
  console.log(`  저장 완료 updatedAt=${result.updatedAt ?? "?"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
