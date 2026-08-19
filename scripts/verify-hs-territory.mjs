/**
 * Usage: node scripts/verify-hs-territory.mjs < state.json
 * Or: curl .../api/state?u=din | node scripts/verify-hs-territory.mjs
 */
import { readFileSync } from "fs";

// Minimal inline copies of key rules (keep in sync with high-society.ts)
const WON_PER = 10_000;
const CM_PER = 5;

function donationToExpandCm(won) {
  const v = Math.max(0, Math.floor(Number(won) || 0));
  if (v === 0 || v % WON_PER !== 0) return 0;
  return (v / WON_PER) * CM_PER;
}

function isEligible(amount) {
  return donationToExpandCm(amount) > 0;
}

function isExcluded(d) {
  return d.hsTerritoryExcluded === true || !isEligible(d.amount);
}

function donorAtMs(d) {
  const at = Number(d.at);
  return Number.isFinite(at) && at > 0 ? Math.floor(at) : 0;
}

function shouldCount(d, settings, link) {
  if (!link?.active) return false;
  if (isExcluded(d)) return false;
  if (d.donationExcluded === true) return false;
  if (!isEligible(d.amount)) return false;
  const at = donorAtMs(d);
  const startedAt = Number(link.startedAt);
  if (Number.isFinite(startedAt) && startedAt > 0 && at < startedAt) return false;
  if (!settings.enabled) return false;
  const reopenAt = Number(settings.territoryReopenAt);
  const cutoffAt = Number(settings.territoryCutoffAt);
  if (reopenAt > 0 && at >= reopenAt) return true;
  if (cutoffAt > 0 && at < cutoffAt) return true;
  if (!cutoffAt && !reopenAt) return true;
  return false;
}

function parsePush(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "left" || v === "l" || v === "←") return "left";
  if (v === "right" || v === "r" || v === "→") return "right";
  if (v === "split" || v === "both" || v === "↔" || v === "half") return "split";
  return null;
}

function seatDir(index, n) {
  if (n <= 1) return "right";
  if (index === 0) return "right";
  if (index === n - 1) return "left";
  return "middle";
}

function pushToLR(cm, dir, systemDir) {
  if (dir === "right") return { left: 0, right: cm };
  if (dir === "left") return { left: cm, right: 0 };
  const push = parsePush(systemDir) || systemDir;
  if (push === "left") return { left: cm, right: 0 };
  if (push === "right") return { left: 0, right: cm };
  return { left: cm / 2, right: cm / 2 };
}

const raw = readFileSync(0, "utf8");
const state = JSON.parse(raw);
const hs = state.highSocietySettings || {};
const seatIds = hs.seatMemberIds || [];
const members = state.members || [];
const donors = state.donors || [];
const memberById = new Map(members.map((m) => [m.id, m]));
const systemMiddle = String(hs.defaultMiddlePush || "right").toLowerCase() === "left" ? "left" : "right";

console.log("=== 상류사회 영토 검증 ===");
console.log(`enabled: ${hs.enabled} | fieldCm: ${hs.fieldCm} | round: ${hs.round} | donors: ${donors.length}`);
console.log(`좌석(${seatIds.length}): ${seatIds.map((id) => memberById.get(id)?.name || id).join(" → ")}`);
console.log(`startedAt: ${seatIds.map((id) => hs.donationLinks?.[id]?.startedAt).join(", ")}`);
console.log("");

const n = seatIds.length;
let totalEligible = 0;
let totalCounted = 0;

for (let i = 0; i < seatIds.length; i++) {
  const id = seatIds[i];
  const name = memberById.get(id)?.name || id;
  const dir = seatDir(i, n);
  const link = hs.donationLinks?.[id] || { active: true };
  const rows = donors.filter((d) => String(d.memberId) === id);
  let left = 0;
  let right = 0;
  let won = 0;
  let eligibleRows = 0;
  let countedRows = 0;
  const countedSamples = [];

  for (const d of rows) {
    const amount = Math.max(0, Math.round(Number(d.amount) || 0));
    if (isEligible(amount)) eligibleRows++;
    if (!shouldCount(d, hs, link)) continue;
    countedRows++;
    totalCounted++;
    const cm = donationToExpandCm(amount);
    won += amount;
    if (dir === "right") right += cm;
    else if (dir === "left") left += cm;
    else {
      const push = parsePush(d.hsPushDir) || systemMiddle;
      const lr = pushToLR(cm, push, systemMiddle);
      left += lr.left;
      right += lr.right;
    }
    if (countedSamples.length < 8) {
      countedSamples.push({ name: d.name, amount, cm, push: d.hsPushDir || "system" });
    }
  }
  totalEligible += eligibleRows;
  const snapW = hs.memberWidthCm?.[id];
  const expand = hs.memberTerritoryExpand?.[id];
  console.log(`[${name}] 좌석=${dir === "middle" ? "가운데" : dir === "left" ? "←끝" : "→끝"}`);
  console.log(`  후원 ${rows.length}건 | 1만배수 ${eligibleRows}건 | 영토집계 ${countedRows}건`);
  console.log(`  expand ←${left}cm / →${right}cm | donationWon(집계) ${won.toLocaleString()}원`);
  console.log(`  서버 memberWidthCm=${snapW ?? "—"} expandSnap=${JSON.stringify(expand || {})}`);
  if (countedSamples.length) {
    console.log(`  샘플: ${countedSamples.map((s) => `${s.name} ${s.amount}→${s.cm}cm`).join(", ")}`);
  }
  console.log("");
}

const offAuto = donors.filter((d) => !isEligible(d.amount)).length;
const offManual = donors.filter((d) => d.hsTerritoryExcluded === true && isEligible(d.amount)).length;
console.log(`자동 영토OFF(비배수): ${offAuto}건 | 수동 OFF(배수): ${offManual}건 | 영토집계 총 ${totalCounted}건`);
