#!/usr/bin/env node
/*
 * scripts/compare-toon-vs-server.mjs
 *
 * 투네이션 후원관리에서 export 한 CSV (output.csv) 와
 * 라이브 서버 GET /api/state?u={userId} donors 를 1:1 매칭 비교
 * ┌───────────────────────────────────────────────────────────────┐
 * │ 4종 매처 (신뢰도 높은 순)
 * │
 * │ 1) L1 EXACT  : Account 이메일 + (time ± 10초) + 금액
 * │                 → 가장 정확. 투네 Account는 유니크 계정
 * │ 2) L2 4WAY   : 이름(Name) + 금액(Amount) + 메시지(Message)
 * │               + (time ± 10초)
 * │                 → Account가 마스킹돼서 이메일 다르거나 비었을때 2차
 * │ 3) L3 LOOSE  : 이름 + 금액 + (time ± 30초)
 * │                 → 메시지가 공백이거나 서로 약간 다를때 3차 fallback
 * │ 4) L4 NOMSG  : 이름 + 금액 + (time ± 60초) + 메시지 비었을 때
 * └───────────────────────────────────────────────────────────────┘
 */

import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import http from "node:http";

// -------------------- 설정 --------------------
const CSV_PATH = process.env.CSV_PATH
  || path.resolve(process.cwd(), "output.csv");
const TARGET = process.env.TARGET || "https://din.finalent.com";
const USER_ID = process.env.USER_ID || process.env.U || "din";
const TIME_TOLERANCE_L1_MS = 10_000;   // ± 10초
const TIME_TOLERANCE_L2_MS = 10_000;   // ± 10초
const TIME_TOLERANCE_L3_MS = 30_000;   // ± 30초
const TIME_TOLERANCE_L4_MS = 60_000;   // ± 60초 (메시지 없을때)
// ----------------------------------------------

const httpsAgent = new https.Agent({ rejectUnauthorized: !process.env.NODE_TLS_REJECT_UNAUTHORIZED });

function fetchJson(url, timeoutMs = 12_000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https:") ? https : http;
    const agent = url.startsWith("https:") ? httpsAgent : undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const req = lib.request(url, { method: "GET", agent, signal: controller.signal }, (res) => {
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        clearTimeout(timer);
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(buf)); }
          catch (e) { reject(new Error(`JSON 파싱 실패: ${e.message}`)); }
        } else {
          reject(new Error(`HTTP ${res.statusCode} ${url} — 응답: ${buf.slice(0, 300)}`));
        }
      });
    });
    req.on("error", (e) => { clearTimeout(timer); reject(e); });
    req.on("abort", () => { clearTimeout(timer); reject(new Error("fetch timeout")); });
    req.end();
  });
}

/**
 * 간단한 CSV 파서 (쉼표/따옴표/줄바꿈 안에 값 들어가는 케이스 처리)
 */
function parseCsv(text) {
  const rows = [];
  let i = 0;
  let field = "";
  let row = [];
  let inQuotes = false;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === "\"") {
        if (text[i + 1] === "\"") { field += "\""; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    switch (c) {
      case "\"": inQuotes = true; i++; break;
      case ",": row.push(field); field = ""; i++; break;
      case "\r": i++; break;
      case "\n":
        row.push(field); field = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = []; i++; break;
      default: field += c; i++; break;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function parseKstToEpochMs(kstStr) {
  // "2026-09-11 17:35:42" 형식 (KST = Asia/Seoul, UTC+9)
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(kstStr || "").trim());
  if (!m) return NaN;
  const [, y, mo, d, h, mi, s] = m;
  const utcMs = Date.UTC(
    Number(y), Number(mo) - 1, Number(d),
    Number(h) - 9, Number(mi), Number(s), 0,
  );
  return utcMs;
}

function fmtKst(epochMs) {
  if (!epochMs || !Number.isFinite(epochMs)) return "-";
  const d = new Date(epochMs + 9 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function fmtWon(n) {
  return `￦${Number(n || 0).toLocaleString("ko-KR")}원`;
}

function normAccount(acct) {
  return String(acct || "").trim().toLowerCase();
}

function normName(n) {
  return String(n || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normMsg(m) {
  return String(m || "")
    .replace(/\s+/g, " ")
    .trim();
}

function donorAtMs(donor) {
  const raw = donor?.at;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (raw <= 0) return 0;
    if (raw < 10_000_000_000) return Math.round(raw * 1000);
    return Math.round(raw);
  }
  if (typeof raw === "string") {
    const trim = raw.trim();
    if (/^-?\d+$/.test(trim)) {
      const n = Number(trim);
      if (!Number.isFinite(n) || n <= 0) return 0;
      if (n < 10_000_000_000) return Math.round(n * 1000);
      return Math.round(n);
    }
    const parsed = Date.parse(trim);
    return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
  }
  return 0;
}

function donorAmount(d) {
  const a = d?.amount;
  if (typeof a === "number") return a;
  if (typeof a === "string" && /^-?\d+(\.\d+)?$/.test(a.trim())) return Number(a.trim());
  return 0;
}

function donorExternalId(d) {
  return String(d?.externalId ?? d?.donorKey ?? d?.primaryKey ?? "").trim();
}

// =================================================================
// 메인
// =================================================================
async function main() {
  // 1) CSV 로드
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`❌ CSV 파일 없음: ${CSV_PATH}\n   프로젝트 루트에 output.csv 를 놓거나 CSV_PATH=/abs/path 환경변수로 지정해주세요.`);
    process.exit(1);
  }
  const csvRaw = fs.readFileSync(CSV_PATH, "utf8").replace(/^\uFEFF/, "");
  const csvAllRows = parseCsv(csvRaw);
  if (csvAllRows.length < 2) {
    console.error(`❌ CSV 내용이 비었거나 헤더뿐: ${CSV_PATH}`);
    process.exit(1);
  }
  const header = csvAllRows[0].map((s) => s.trim());
  const idxT = header.findIndex((h) => /^time|일시|알림시각|시간|created/i.test(h));
  const idxA = header.findIndex((h) => /^account|이메일|아이디|닉네임\(ID\)|email/i.test(h));
  const idxN = header.findIndex((h) => /^name|닉네임|후원자/i.test(h));
  const idxAm = header.findIndex((h) => /^amount|금액|후원금액/i.test(h));
  const idxM = header.findIndex((h) => /^message|내용|메시지|코멘트/i.test(h));
  if (idxT < 0 || idxAm < 0 || idxN < 0) {
    console.error(`❌ CSV 헤더에서 필수 컬럼을 못찾음 — 헤더: [${header.join(" / ")}]\n   필요: Time/일시 + Name/닉네임 + Amount/금액`);
    process.exit(1);
  }
  const csv = [];
  let parseFail = 0;
  for (let r = 1; r < csvAllRows.length; r++) {
    const row = csvAllRows[r];
    if (row.length === 0 || (row.length === 1 && !row[0])) continue;
    const t = parseKstToEpochMs(row[idxT]);
    const amt = Number(String(row[idxAm] || "0").replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(t) || !Number.isFinite(amt)) { parseFail++; continue; }
    csv.push({
      csvLineNo: r + 1,
      timeMs: t,
      account: idxA >= 0 ? normAccount(row[idxA]) : "",
      nameRaw: String(row[idxN] ?? "").trim(),
      name: normName(row[idxN]),
      amount: amt,
      messageRaw: idxM >= 0 ? String(row[idxM] ?? "").trim() : "",
      message: idxM >= 0 ? normMsg(row[idxM]) : "",
    });
  }

  // 2) 서버 state 로드
  const url = `${TARGET.replace(/\/+$/, "")}/api/state?u=${encodeURIComponent(USER_ID)}&t=${Date.now()}`;
  let state;
  try {
    state = await fetchJson(url);
  } catch (e) {
    console.error(`❌ 서버 state GET 실패: ${url}\n   ${e.message}`);
    console.error("   대안: 환경변수 TARGET=http://127.0.0.1:3000 로 바꾸거나, 내부 IP/localhost 로 붙어보세요.");
    process.exit(1);
  }
  if (!Array.isArray(state?.donors)) {
    console.error(`❌ /api/state 응답에 donors 배열이 없음 — keys: ${Object.keys(state || {}).join(", ")}`);
    process.exit(1);
  }
  const donors = (state.donors || [])
    .filter((d) => !d?.donationExcluded)
    .map((d) => ({
      id: String(d?.id || ""),
      externalId: donorExternalId(d),
      atMs: donorAtMs(d),
      account: normAccount(d?.accountEmail || d?.email || ""),
      nameRaw: String(d?.name || "").trim(),
      name: normName(d?.name),
      amount: donorAmount(d),
      messageRaw: String(d?.message || "").trim(),
      message: normMsg(d?.message),
      target: String(d?.target || ""),
      memberId: String(d?.memberId || ""),
    }));

  // 통계용
  const csvTotalCount = csv.length;
  const csvTotalAmt = csv.reduce((s, x) => s + (x.amount || 0), 0);
  const srvTotalCount = donors.length;
  const srvTotalAmt = donors.reduce((s, x) => s + (x.amount || 0), 0);

  // 3) 1:1 매칭 — CSV 행 하나를 서버 donor 하나에만 맵핑 (greedy L1→L4)
  const usedSrvIdx = new Set();
  const matched = [];
  const unmatchedCsv = [];

  // 매처 순서
  const matchers = [
    (c, s) => {
      if (c.account && s.account && c.account === s.account) {
        if (Math.abs(c.timeMs - s.atMs) <= TIME_TOLERANCE_L1_MS && c.amount === s.amount) return "L1_EXACT_ACCOUNT";
      }
      return null;
    },
    (c, s) => {
      if (
        c.name && s.name && c.name === s.name &&
        c.amount === s.amount &&
        c.message && s.message && c.message === s.message &&
        Math.abs(c.timeMs - s.atMs) <= TIME_TOLERANCE_L2_MS
      ) return "L2_4WAY_EXACT";
      return null;
    },
    (c, s) => {
      if (
        c.name && s.name && c.name === s.name &&
        c.amount === s.amount &&
        Math.abs(c.timeMs - s.atMs) <= TIME_TOLERANCE_L3_MS
      ) return "L3_3WAY_LOOSE";
      return null;
    },
    (c, s) => {
      if (
        c.name && s.name && c.name === s.name &&
        c.amount === s.amount &&
        (!c.message || !s.message) &&
        Math.abs(c.timeMs - s.atMs) <= TIME_TOLERANCE_L4_MS
      ) return "L4_NOMSG";
      return null;
    },
  ];

  for (const cRow of csv) {
    let hit = null;
    for (let mi = 0; mi < matchers.length && !hit; mi++) {
      const matcher = matchers[mi];
      for (let si = 0; si < donors.length; si++) {
        if (usedSrvIdx.has(si)) continue;
        const tag = matcher(cRow, donors[si]);
        if (tag) {
          usedSrvIdx.add(si);
          hit = { cRow, sIdx: si, sRow: donors[si], tag };
          matched.push(hit);
          break;
        }
      }
    }
    if (!hit) unmatchedCsv.push(cRow);
  }

  const unmatchedSrv = [];
  for (let si = 0; si < donors.length; si++) {
    if (!usedSrvIdx.has(si)) unmatchedSrv.push({ sIdx: si, sRow: donors[si] });
  }

  // 4) 서버 측 자체 중복 (같은 externalId / id base 2회 이상 출현)
  const byExt = new Map();
  const byIdBase = new Map();
  for (const d of donors) {
    if (d.externalId) {
      const key = d.externalId;
      if (!byExt.has(key)) byExt.set(key, []);
      byExt.get(key).push(d);
    }
    const base = String(d.id || "").replace(/^[^:]+:/, "");
    if (base && /^\d+$/.test(base)) {
      if (!byIdBase.has(base)) byIdBase.set(base, []);
      byIdBase.get(base).push(d);
    }
  }
  const dupExtGroups = [...byExt.values()].filter((g) => g.length > 1);
  const dupIdGroups = [...byIdBase.values()].filter((g) => g.length > 1);

  // 5) 출력
  const div = "═".repeat(100);
  console.log(div);
  console.log("  🧭  투네이션 CSV ↔ 라이브 서버 donors 1:1 대조 리포트");
  console.log(`  CSV   : ${CSV_PATH} (${csvTotalCount}행 · 총액 ${fmtWon(csvTotalAmt)})`);
  console.log(`  서버  : ${url.split("?")[0]}?u=${USER_ID} (${srvTotalCount}건 · 총액 ${fmtWon(srvTotalAmt)})`);
  console.log(`  CSV 파싱 실패 라인 (타임스탬프/금액): ${parseFail}건`);
  console.log(div);

  const matchedAmt = matched.reduce((s, m) => s + m.cRow.amount, 0);
  const unmatchedCsvAmt = unmatchedCsv.reduce((s, c) => s + c.amount, 0);
  const unmatchedSrvAmt = unmatchedSrv.reduce((s, x) => s + x.sRow.amount, 0);

  console.log("");
  console.log("┌─────────────────────────────────┬─────────────┬─────────────────┐");
  console.log("│ 구분                            │  건수       │  금액           │");
  console.log("├─────────────────────────────────┼─────────────┼─────────────────┤");
  console.log(`│ [투네 CSV] 합계                 │ ${String(csvTotalCount).padStart(6)}건    │ ${fmtWon(csvTotalAmt).padStart(15)} │`);
  console.log(`│ [서버 donors] 합계              │ ${String(srvTotalCount).padStart(6)}건    │ ${fmtWon(srvTotalAmt).padStart(15)} │`);
  console.log("├─────────────────────────────────┼─────────────┼─────────────────┤");
  console.log(`│ ✅ 1:1 매치 성공 (양쪽 다 있음)│ ${String(matched.length).padStart(6)}건    │ ${fmtWon(matchedAmt).padStart(15)} │`);
  console.log(`│   ㄴ L1_ACCOUNT (이메일+시간)  │ ${String(matched.filter(m => m.tag === "L1_EXACT_ACCOUNT").length).padStart(6)}건    │                 │`);
  console.log(`│   ㄴ L2_4WAY (이름+금액+메시지) │ ${String(matched.filter(m => m.tag === "L2_4WAY_EXACT").length).padStart(6)}건    │                 │`);
  console.log(`│   ㄴ L3_3WAY (이름+금액+30초)   │ ${String(matched.filter(m => m.tag === "L3_3WAY_LOOSE").length).padStart(6)}건    │                 │`);
  console.log(`│   ㄴ L4_NOMSG (메시지없이 60초) │ ${String(matched.filter(m => m.tag === "L4_NOMSG").length).padStart(6)}건    │                 │`);
  console.log("├─────────────────────────────────┼─────────────┼─────────────────┤");
  console.log(`│ ❌ CSV에만 있고 서버엔 없음(누락)│ ${String(unmatchedCsv.length).padStart(6)}건    │ ${fmtWon(unmatchedCsvAmt).padStart(15)} │`);
  console.log(`│ ❌ 서버에만 있고 CSV엔 없음(중복)│ ${String(unmatchedSrv.length).padStart(6)}건    │ ${fmtWon(unmatchedSrvAmt).padStart(15)} │`);
  console.log("├─────────────────────────────────┼─────────────┼─────────────────┤");
  const cntDelta = srvTotalCount - csvTotalCount;
  const amtDelta = srvTotalAmt - csvTotalAmt;
  console.log(`│ 🔍 최종 차이 (서버 - CSV)       │ ${(cntDelta>=0?"+":"")+String(cntDelta).padStart(5)}건    │ ${(amtDelta>=0?"+":"")+fmtWon(amtDelta).padStart(14)} │`);
  console.log("└─────────────────────────────────┴─────────────┴─────────────────┘");

  // 6) 서버 자체 중복 리포트
  console.log("");
  console.log("─── 🚨 서버 donors 내부 자체 중복 체크 ───────────────────────");
  console.log(`   externalId 동일값 2회 이상 출현 그룹 : ${dupExtGroups.length} 그룹`);
  if (dupExtGroups.length) {
    dupExtGroups.slice(0, 20).forEach((g, i) => {
      console.log(`     [ExtDup#${i + 1}]  externalId=${g[0].externalId}  →  ${g.length}건  ×  ${fmtWon(g[0].amount)}  =  부풀림총액 ${fmtWon((g.length - 1) * g[0].amount)}`);
      g.forEach((d) => console.log(`        · id=${d.id || "-"}  at=${fmtKst(d.atMs)}  name=${d.nameRaw || "-"}  msg=${(d.messageRaw || "").slice(0, 40) || "(빈메시지)"}  target=${d.target || "-"}`));
    });
  }
  console.log(`   donor.id 숫자베이스 동일값 2회 이상 출현 그룹 : ${dupIdGroups.length} 그룹`);
  if (dupIdGroups.length) {
    dupIdGroups.slice(0, 15).forEach((g, i) => {
      const key = String(g[0].id || "").replace(/^[^:]+:/, "");
      console.log(`     [IdDup#${i + 1}]  idBase=${key}  →  ${g.length}건  ×  ${fmtWon(g[0].amount)}`);
      g.forEach((d) => console.log(`        · id=${d.id || "-"}  extId=${d.externalId || "-"}  at=${fmtKst(d.atMs)}  name=${d.nameRaw || "-"}`));
    });
  }

  // 7) CSV에만 있음 (누락 의심) 상세
  console.log("");
  console.log("─── 🟡 CSV에만 있고 서버 매칭 실패 (총 누락 의심) ─────────────────");
  if (unmatchedCsv.length === 0) {
    console.log("   ✅ 0건 — 누락 0");
  } else {
    unmatchedCsv.slice(0, 30).forEach((c) => {
      console.log(`   L${String(c.csvLineNo).padStart(4)}  at=${fmtKst(c.timeMs)}  acc=${c.account || "-"}  name=${c.nameRaw || "-"}  amt=${fmtWon(c.amount)}  msg=${(c.messageRaw || "").slice(0, 50) || "(빈메시지)"}`);
    });
    if (unmatchedCsv.length > 30) console.log(`   ... 외 ${unmatchedCsv.length - 30}건`);
  }

  // 8) 서버에만 있음 (중복 의심) 상세
  console.log("");
  console.log("─── 🔴 서버에만 있고 CSV 매칭 실패 (총 중복 의심) ─────────────────");
  if (unmatchedSrv.length === 0) {
    console.log("   ✅ 0건 — 중복 0");
  } else {
    unmatchedSrv.slice(0, 30).forEach((x, i) => {
      const d = x.sRow;
      console.log(`   #${i + 1}  id=${d.id || "-"}  extId=${d.externalId || "-"}  at=${fmtKst(d.atMs)}  name=${d.nameRaw || "-"}  amt=${fmtWon(d.amount)}  msg=${(d.messageRaw || "").slice(0, 50) || "(빈메시지)"}  tgt=${d.target || "-"}  mem=${d.memberId || "-"}`);
    });
    if (unmatchedSrv.length > 30) console.log(`   ... 외 ${unmatchedSrv.length - 30}건`);
  }

  // 9) 최종 판정
  console.log("");
  console.log(div);
  const isClean = (unmatchedCsv.length === 0 && unmatchedSrv.length === 0 && dupExtGroups.length === 0 && dupIdGroups.length === 0);
  if (isClean) {
    console.log("   ✅  최종 판정: **클린**  —  CSV와 서버 100% 일치 · 서버 내 중복 0건 · 누락/추가적재 0건");
  } else {
    const problems = [];
    if (dupExtGroups.length || dupIdGroups.length) problems.push(`서버 내부 중복그룹 ${dupExtGroups.length + dupIdGroups.length}개`);
    if (unmatchedSrv.length) problems.push(`서버에만 ${unmatchedSrv.length}건 (${fmtWon(unmatchedSrvAmt)} 추가적재 의심)`);
    if (unmatchedCsv.length) problems.push(`CSV에만 ${unmatchedCsv.length}건 (${fmtWon(unmatchedCsvAmt)} 누락 의심)`);
    console.log(`   ⚠️  최종 판정: 이슈 있음 —  ${problems.join(" / ")}`);
  }
  console.log(div);
  process.exit(isClean ? 0 : 2);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
