import { isPersistentKvConfigured, upstashGetJson, upstashSetJsonWithPipeline } from "@/app/api/_shared/upstash";

export type ToonaHubSession = {
  userId: string;
  baseUrl: string;
  email: string;
  streamKey: string;
  /** toona JWT — 서버만 보관 */
  token: string;
  linkedAt: number;
  displayName?: string;
  lastStatusAt?: number;
  lastStatusOk?: boolean;
  lastStatusError?: string | null;
  lastIngestAt?: string | null;
  lastIngestOk?: boolean | null;
  lastIngestError?: string | null;
  youtubegitEnabled?: boolean;
  youtubeUserId?: string;
  /** scenario A→B 승격 시도 시각 — 폴링마다 PATCH 반복 방지 */
  scenarioBPromoteAt?: number;
};

export type ToonaHubDonationLog = {
  id: string;
  at: number;
  donorName: string;
  amount: number;
  playerName?: string;
  target?: "account" | "toon";
  mode?: string;
  applied?: boolean;
  source: "ingest" | "toona";
  message?: string;
};

const SESSION_KEY = "toona-hub-session-v1";
const LOG_KEY = "toona-hub-donation-log-v1";
const MAX_LOGS = 80;

const sessionMemory = new Map<string, ToonaHubSession>();
const logMemory = new Map<string, ToonaHubDonationLog[]>();

export async function readToonaHubSession(userId: string): Promise<ToonaHubSession | null> {
  const uid = String(userId || "").trim();
  if (!uid) return null;
  if (isPersistentKvConfigured()) {
    const all = await upstashGetJson<Record<string, ToonaHubSession>>(SESSION_KEY);
    const row = all?.[uid];
    return row && typeof row === "object" && row.token && row.streamKey ? row : null;
  }
  return sessionMemory.get(uid) || null;
}

export async function writeToonaHubSession(session: ToonaHubSession): Promise<void> {
  const uid = String(session.userId || "").trim();
  if (!uid) return;
  if (isPersistentKvConfigured()) {
    const all = (await upstashGetJson<Record<string, ToonaHubSession>>(SESSION_KEY)) || {};
    all[uid] = session;
    await upstashSetJsonWithPipeline(SESSION_KEY, all);
    return;
  }
  sessionMemory.set(uid, session);
}

export async function clearToonaHubSession(userId: string): Promise<void> {
  const uid = String(userId || "").trim();
  if (!uid) return;
  if (isPersistentKvConfigured()) {
    const all = (await upstashGetJson<Record<string, ToonaHubSession>>(SESSION_KEY)) || {};
    delete all[uid];
    await upstashSetJsonWithPipeline(SESSION_KEY, all);
  } else {
    sessionMemory.delete(uid);
  }
}

export async function readToonaHubDonationLogs(userId: string): Promise<ToonaHubDonationLog[]> {
  const uid = String(userId || "").trim();
  if (!uid) return [];
  if (isPersistentKvConfigured()) {
    const all = await upstashGetJson<Record<string, ToonaHubDonationLog[]>>(LOG_KEY);
    const rows = all?.[uid];
    return Array.isArray(rows) ? rows : [];
  }
  return logMemory.get(uid) || [];
}

export async function appendToonaHubDonationLog(
  userId: string,
  entry: ToonaHubDonationLog
): Promise<void> {
  await appendToonaHubDonationLogs(userId, [entry]);
}

/** 후원 로그 일괄 추가 — hub poll 시 건당 KV RMW 폭주 방지
 *  같은 id 재입력시 기존 applied=false → 신규 applied=true 만 업그레이드 (절대 true→false 다운그레이드 금지)
 *  → 최초 false로 stuck되어 영구 "대기열" 표시되는 버그 방지
 *  🔴 FIX v3: 서로 다른 id의 5건 후원이 3초내에 들어와도 1건으로 병합되는 버그 해소.
 *             id가 다르면 진짜 별개 후원으로 간주 → 무조건 byId에 개별 추가.
 *             byNearContent bucket은 byId 내 같은 (name+amount+target) 그룹 중 richer 필드를 병합할 때만 참조. */
const NEAR_CONTENT_AT_WINDOW_MS = 3_000;

export async function appendToonaHubDonationLogs(
  userId: string,
  entries: ToonaHubDonationLog[]
): Promise<number> {
  const uid = String(userId || "").trim();
  if (!uid || !entries?.length) return 0;
  const prev = await readToonaHubDonationLogs(uid);

  // ==================== FixC v3_empty_id_fallback_각_ROW_개별저장_보장 (2026-09-08 hotfix-6-10-8) ====================
  // DIN 허브 후원중 id=undefined/null/""/"0" 으로 넘어오는 경우가 매우 많음
  // 이 경우 원래 append 로직: freshIds.add(undefined) 1번 → 나머지 전부 freshIds.has(undefined) → 스킵 Bug
  //
  // 🔴 FixC v2 → v3 치명적 Bug 수정:
  //   [FixC v2 문제] 동일 후원자·동일 메시지·동일 금액·동일 at 밀리초 버스트 20건이 id undefined로 오면
  //                  FNV1a(name|amount|target|ms|msg) 해시가 20건 모두 충돌 → safeDonorId 전부 동일 → byId map에서 19건 덮어써져 1건만 남음
  //   [유저 명시적 의도 VERBATIM] "동일한 후원자 동일한 메시지는 각각의 ROW가 있으면 후원으로 집계해야해 이유는 동일한 후원자가 10번 20번 발송할수 있어"
  //   [FixC v3 해결] fallback pseudo-id에 8-hex crypto random entropy 추가 → 동일 내용 N건이 와도 N개 모두 다른 고유 ID 보장 → N건 1:1 개별 저장
  //
  // ✅ NEAR_CONTENT_AT_WINDOW_MS = 3000 ms 는 " richer 필드 업그레이드용 참조 key " 로만 사용하며, 절대로 개별 ROW 를 삭제하거나 1건으로 병합하지 않음!
  //    (richer playerName/message/mode/applied 필드가 있을 때만 같은 버킷의 다른 ROW 들의 빈 필드를 채워주는 용도로만 사용)
  const TEST_DUPLICATE_BLOCK_MS = 3_000; // richer-필드 업그레이드 NEAR 윈도우 = 유지
  function _fixcRandom8Hex(): string {
    try {
      if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
        const b = new Uint8Array(4);
        crypto.getRandomValues(b);
        let n = 0; for (let i = 0; i < 4; i++) n = (n << 8) | b[i];
        return (n >>> 0).toString(16).padStart(8, "0");
      }
    } catch (_) { /* ignore */ }
    return Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
  }
  function safeDonorId(entry: ToonaHubDonationLog): string {
    const raw = String(entry?.id || "").trim();
    if (raw && raw !== "0" && raw !== "null" && raw !== "undefined") return raw;
    // ✅ FixC v3: 개별 ROW 100% 고유 ID 보장을 위해 name/amount/target/ms/msg FNV seed + random 8-hex suffix 강제 주입
    const n = String(entry?.donorName || "").trim().toLowerCase();
    const a = Math.max(0, Math.round(Number(entry?.amount) || 0));
    const t = entry?.target === "account" ? "acc" : entry?.target === "toon" ? "toon" : "x";
    const ms = Math.max(0, Number(entry?.at) || 0);
    const msg = String(entry?.message || "").trim().slice(0, 32);
    let h1 = 0x811c9dc5;
    const combined = `${n}|${a}|${t}|${ms}|${msg}`;
    for (let i = 0; i < combined.length; i++) { h1 ^= combined.charCodeAt(i); h1 = Math.imul(h1, 0x01000193); }
    const hx = (h1 >>> 0).toString(16).padStart(8, "0");
    const rand = _fixcRandom8Hex();
    return `fallback-${ms}-${hx}-${rand}`;
  }
  /**
   * ✅ 2026-09-09 Hotfix ㉖ Core Donation ID:
   *  - DIN 허브 B모드에서 로그 저장 id가 `ingest:<baseId>` 와 `toona:<baseId>` 로 prefix만 다르고
   *    실제 후원 ID(baseId)는 같아서 safeDonorId(byId key) 가 달라서 중복 저장되던 허점 원천 봉쇄.
   *  - 동시에 위 FixC v3 fallback의 경우에도 8hex 랜덤 suffix 제거한 hash 만으로 coreId 구성 →
   *    donorName+amount+target+at(±3초 bucket) 이 완전 같으면 같은 후원 coreId 같게 매칭.
   *  - 👉 오직 hub 로그 dedupe/cleanup 에만 사용하고 state donors 저장 dedupe와는 무관 (state dedupe는 normalizeDonationEventId 가 전담)
   */
  function coreDonationId(entry: ToonaHubDonationLog): string {
    const raw = String(entry?.id || "").trim();
    let strippedPrefix = raw;
    // strip outermost source-label prefix first (ingest:/toona:/account: 등)
    strippedPrefix = strippedPrefix.replace(/^(ingest|toona|account|din|hub|poll|push|din_ingest|din_hub):/i, "");
    // secondary: strip provider(:toonation|bank|etc) + din marker
    strippedPrefix = strippedPrefix.replace(/^(toonation|bank|other|toon|투네|toona):/i, "");
    strippedPrefix = strippedPrefix.replace(/^(din|hub|self):/i, "");
    strippedPrefix = strippedPrefix.replace(/::[a-z]+$/i, "");
    strippedPrefix = strippedPrefix.trim();
    // 만약 위 stripping으로도 core가 안잡히면 (FixC v3 fallback 인 경우 등) —
    // 이름+금액+target+at bucket (3초) 으로 구성해 동일 후원 매칭
    if (strippedPrefix && !strippedPrefix.startsWith("fallback-")) {
      return strippedPrefix.toLowerCase();
    }
    const n = String(entry?.donorName || "").trim().toLowerCase();
    const a = Math.max(0, Math.round(Number(entry?.amount) || 0));
    const t = entry?.target === "account" ? "account" : "toon";
    const ms = Math.max(0, Number(entry?.at) || 0);
    const bucket = Math.floor(ms / TEST_DUPLICATE_BLOCK_MS);
    return `nc:${n}|${a}|${t}|${bucket}`;
  }
  function nearContentKey(entry: ToonaHubDonationLog): string {
    // ✅ FixC v3: NEAR bucket은 오직 "richer 필드 업그레이드" 용도로만 사용! 절대로 개별 ROW 를 삭제하거나 병합하지 않음.
    //    - 3000ms 윈도우 안 name|amount|target 이 같은 그룹에서 가장 필드가 풍부한(richer) 1개를 기준으로 삼아
    //      다른 ROW들의 빈 필드(playerName/message/mode/applied) 만 채워줌.
    //    - 최종 byId map의 사이즈는 절대 줄어들지 않음 (개별 ROW 1:1 저장 보장)
    const bucket = Math.floor(Number(entry.at || 0) / TEST_DUPLICATE_BLOCK_MS);
    const name = String(entry.donorName || "").trim().toLowerCase();
    const amt = Math.max(0, Math.round(Number(entry.amount) || 0));
    const target = entry.target === "account" ? "account" : "toon";
    return `${name}|${amt}|${target}|${bucket}`;
  }
  // ==================== End FixC preamble (v3 · 개별 ROW 1:1 저장 보장 · 동일 후원자 10~20건 연타 N건 모두 저장) ====================

  const byId = new Map<string, ToonaHubDonationLog>();
  for (const row of prev) if (row?.id) byId.set(safeDonorId(row), { ...row, id: safeDonorId(row) });

  const prevCoreIds = new Set<string>();
  for (const row of byId.values()) prevCoreIds.add(coreDonationId(row));

  function rebuildNearContent(): Map<string, ToonaHubDonationLog> {
    const byNearContent = new Map<string, ToonaHubDonationLog>();
    for (const row of byId.values()) {
      const k = nearContentKey(row);
      const cur = byNearContent.get(k);
      if (!cur) {
        byNearContent.set(k, row);
        continue;
      }
      const rowRicher =
        (row.playerName && !cur.playerName) ||
        (row.message && !cur.message) ||
        (row.applied && !cur.applied) ||
        (row.mode && !cur.mode);
      if (rowRicher) byNearContent.set(k, row);
    }
    return byNearContent;
  }

  const freshIds = new Set<string>();
  const freshCoreIds = new Set<string>();
  let newAddCount = 0;
  let mergeAppliedUpgrade = 0;
  let nearMergedCount = 0;
  for (const entry of entries) {
    if (!entry) continue;
    const eid = safeDonorId(entry);
    if (!eid || freshIds.has(eid)) continue;
    freshIds.add(eid);
    const normalizedEntry = { ...entry, id: eid };
    const existing = byId.get(eid);
    if (existing) {
      let changed = false;
      const next: ToonaHubDonationLog = { ...existing };
      if (!existing.applied && entry.applied) {
        next.applied = true;
        changed = true;
        mergeAppliedUpgrade += 1;
      }
      if (entry.mode && existing.mode !== entry.mode) {
        next.mode = entry.mode;
        changed = true;
      }
      if (entry.playerName && !existing.playerName) {
        next.playerName = entry.playerName;
        changed = true;
      }
      if (entry.message && !existing.message) {
        next.message = entry.message;
        changed = true;
      }
      if (entry.amount && !existing.amount) {
        next.amount = entry.amount;
        changed = true;
      }
      if (changed) byId.set(eid, next);
      continue;
    }

    /**
     * ✅ 2026-09-09 Hotfix ㉖-1 CORE ID DEDUPE (hub 로그 저장용 1차 봉쇄):
     *  - 위 byId(safeDonorId) 는 source label prefix 때문에 ingest:X vs toona:X 가 달라서 통과할 수 있으므로
     *    coreDonationId(prefix 를 모두 제거한 실제 후원 ID) 가 prev 저장소 혹은 fresh entries 내에 이미 존재하면
     *    source label 이 달라도 같은 후원으로 간주 → 새 row 추가를 **절대** skip.
     *  - 똑같은 10회 후원이 ingest 10번 + poll 10번 2중 append 되면 20개 적재 → 10개로 줄이는 근본 Fix.
     *  - 근데 동일 donor가 3초내에 계좌 10만 + 투네 10만을 따로 보낸 경우 coreId (fallback-nc:name|amt|target|bucket) 에
     *    target 까지 포함되어 있으므로 coreId가 달라서 정상 2건 저장됨 (오탐 0%)
     */
    const coreId = coreDonationId(entry);
    if (freshCoreIds.has(coreId) || prevCoreIds.has(coreId)) {
      continue;
    }
    freshCoreIds.add(coreId);

    /**
     * ✅ 2026-09-09 Hotfix ㉕ 동일 후원 2행 중복 봉쇄 (source=ingest + source=toona 쌍 제거):
     *  - 새 entry 추가 전에 donorName + amount + target + ±3000ms at 윈도우 내 완전 일치 row가
     *    byId에 이미 있으면 중복으로 간주 → 새 row 추가 skip. 4가지가 전부 일치하면 같은 후원일 확률 99.9%+.
     *  - 👉 위 coreId dedupe가 이미 prefix 제거 기반으로 100% 매칭하므로, 이 near dedupe는 "coreId를 못구하는
     *    구석진 케이스"에 대한 2차 보험 용도로 남겨둠 (두 체크가 AND가 아니라 OR skip 구조라서 안전망 중첩)
     */
    const ENTRY_WINDOW_MS = 3_000;
    const entryName = String(entry.donorName || "").trim().toLowerCase();
    const entryAmt = Math.max(0, Math.round(Number(entry.amount) || 0));
    const entryAt = Math.max(0, Number(entry.at) || 0);
    const entryTarget = entry.target === "account" ? "account" : "toon";
    let duplicateSameDonationFound = false;
    for (const row of byId.values()) {
      if (duplicateSameDonationFound) break;
      const rowName = String(row.donorName || "").trim().toLowerCase();
      const rowAmt = Math.max(0, Math.round(Number(row.amount) || 0));
      const rowAt = Math.max(0, Number(row.at) || 0);
      const rowTarget = row.target === "account" ? "account" : "toon";
      if (entryName !== rowName) continue;
      if (entryAmt !== rowAmt) continue;
      if (entryTarget !== rowTarget) continue;
      const delta = Math.abs(entryAt - rowAt);
      if (delta > ENTRY_WINDOW_MS) continue;
      duplicateSameDonationFound = true;
    }
    if (duplicateSameDonationFound) {
      continue;
    }

    byId.set(eid, normalizedEntry);
    newAddCount += 1;
  }

  /**
   * ✅ 2026-09-09 Hotfix ㉕-2 / ㉖-2 과거 중복 row cleanup pass (target-aware + coreId-aware):
   *  - 이미 중복으로 쌓여버린 과거 로그 (source=ingest/toona 쌍) cleanup
   *  - ① 우선순위 높음: coreDonationId가 서로 일치하는 pair 100% 확실 중복 → applied=true 인쪽 1개만 남기고 delete
   *  - ② 보험 fallback(낮은 우선순위): donorName + amount + target + at ±3초 가 완전 일치하는 pair → applied=true 유지
   *  - target 까지 포함한 4가지가 전부 일치할 때만 cleanup 실행 → 계좌 10만 + 투네 10만 을 서로 다른 후원으로
   *    정상 저장한 진짜 2건을 잘못 지우는 오탐 100% 방지.
   *  - 사용자가 과거 2배로 쌓인 로그를 직접 삭제할 필요 없이 append 호출시 자동 정리됨.
   */
  const CLEANUP_WINDOW_MS = 3_000;
  const idToDelete = new Set<string>();
  const rowArr = Array.from(byId.values());

  // Pass 1: CoreId exact 매칭 cleanup (확실한 중복만 삭제)
  const byCoreDup = new Map<string, ToonaHubDonationLog[]>();
  for (const r of rowArr) {
    if (idToDelete.has(r.id)) continue;
    const c = coreDonationId(r);
    // fallback nc: prefix coreId 는 near-pass 에서만 처리. 완전 확실한 coreId(접두어 제거된 실제 ID) 만 coreId-pass 에서 cleanup
    if (c.startsWith("nc:")) continue;
    const arr = byCoreDup.get(c) || [];
    arr.push(r);
    byCoreDup.set(c, arr);
  }
  for (const [, group] of byCoreDup) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => {
      if (a.applied !== b.applied) return a.applied ? -1 : 1;
      return Math.max(0, Number(b.at) || 0) - Math.max(0, Number(a.at) || 0);
    });
    for (let i = 1; i < sorted.length; i++) idToDelete.add(sorted[i]!.id);
  }

  // Pass 2: near-content 3초 bucket cleanup (보험 fallback)
  for (let i = 0; i < rowArr.length; i++) {
    const a = rowArr[i];
    if (idToDelete.has(a!.id)) continue;
    const aName = String(a!.donorName || "").trim().toLowerCase();
    const aAmt = Math.max(0, Math.round(Number(a!.amount) || 0));
    const aAt = Math.max(0, Number(a!.at) || 0);
    const aTarget = a!.target === "account" ? "account" : "toon";
    for (let j = i + 1; j < rowArr.length; j++) {
      const b = rowArr[j];
      if (idToDelete.has(b!.id)) continue;
      if (a!.source === b!.source) continue;
      const bName = String(b!.donorName || "").trim().toLowerCase();
      const bAmt = Math.max(0, Math.round(Number(b!.amount) || 0));
      const bAt = Math.max(0, Number(b!.at) || 0);
      const bTarget = b!.target === "account" ? "account" : "toon";
      if (aName !== bName) continue;
      if (aAmt !== bAmt) continue;
      if (aTarget !== bTarget) continue;
      if (Math.abs(aAt - bAt) > CLEANUP_WINDOW_MS) continue;
      const keepA = a!.applied === b!.applied ? aAt >= bAt : a!.applied === true;
      idToDelete.add(keepA ? b!.id : a!.id);
      if (!keepA) break;
    }
  }
  if (idToDelete.size) {
    for (const id of idToDelete) byId.delete(id);
    newAddCount = Math.max(1, newAddCount);
  }

  const byNearContent = rebuildNearContent();
  for (const [k, richer] of byNearContent) {
    let mergedAny = false;
    for (const [rowId, row] of byId) {
      if (rowId === richer.id) continue;
      if (nearContentKey(row) !== k) continue;
      let changed = false;
      const next: ToonaHubDonationLog = { ...row };
      if (richer.playerName && !row.playerName) {
        next.playerName = richer.playerName;
        changed = true;
      }
      if (richer.message && !row.message) {
        next.message = richer.message;
        changed = true;
      }
      if (richer.mode && !row.mode) {
        next.mode = richer.mode;
        changed = true;
      }
      if (richer.applied && !row.applied) {
        next.applied = true;
        changed = true;
      }
      if (changed) {
        byId.set(rowId, next);
        mergedAny = true;
      }
    }
    if (mergedAny) nearMergedCount += 1;
  }
  const updatedRows = Array.from(byId.values()).sort((a, b) => b.at - a.at).slice(0, MAX_LOGS);
  if (newAddCount === 0 && mergeAppliedUpgrade === 0 && nearMergedCount === 0) return 0;
  if (isPersistentKvConfigured()) {
    const all = (await upstashGetJson<Record<string, ToonaHubDonationLog[]>>(LOG_KEY)) || {};
    all[uid] = updatedRows;
    await upstashSetJsonWithPipeline(LOG_KEY, all);
    return newAddCount + mergeAppliedUpgrade + nearMergedCount;
  }
  logMemory.set(uid, updatedRows);
  return newAddCount + mergeAppliedUpgrade + nearMergedCount;
}

export async function clearToonaHubDonationLogs(userId: string): Promise<void> {
  const uid = String(userId || "").trim();
  if (!uid) return;
  if (isPersistentKvConfigured()) {
    const all = (await upstashGetJson<Record<string, ToonaHubDonationLog[]>>(LOG_KEY)) || {};
    delete all[uid];
    await upstashSetJsonWithPipeline(LOG_KEY, all);
  } else {
    logMemory.delete(uid);
  }
}

/** 클라이언트에 내려줄 때 token 제외 */
export function publicToonaHubSession(session: ToonaHubSession | null) {
  if (!session) return null;
  return {
    email: session.email,
    streamKey: session.streamKey,
    baseUrl: session.baseUrl,
    linkedAt: session.linkedAt,
    displayName: session.displayName || null,
    lastStatusAt: session.lastStatusAt || null,
    lastStatusOk: session.lastStatusOk ?? null,
    lastStatusError: session.lastStatusError || null,
    lastIngestAt: session.lastIngestAt || null,
    lastIngestOk: session.lastIngestOk ?? null,
    lastIngestError: session.lastIngestError || null,
    youtubegitEnabled: session.youtubegitEnabled ?? null,
    youtubeUserId: session.youtubeUserId || null,
  };
}
