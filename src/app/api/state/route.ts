export const runtime = "edge";
export const revalidate = 0;

import type { AppState } from "@/lib/state";
import { defaultState, mergeDonorsForMultiTabSave } from "@/lib/state";
import { createModuleLogger } from "@/lib/logger";
import { AUTH_COOKIE, isDevAuthBypassRequest } from "@/lib/auth";
import { isLegacyMigrationTargetUserId } from "@/lib/legacy-migration";
import { getServerMemoryAppState, setServerMemoryAppState } from "@/lib/server-memory-app-state";
import { isRouletteLocked } from "../roulette/roulette-lock";
import { loadAppStateForRoulette } from "../roulette/edge-state-store";

const logger = createModuleLogger('API/State');

const STORAGE_KEY_BASE = "excel-broadcast-state-v1";
const STORAGE_KEY_LEGACY = "excel-broadcast-state-v1";

function getUserId(req: Request): string | null {
  const url = new URL(req.url);
  const fromUrl = url.searchParams.get("user");
  if (fromUrl && fromUrl.trim()) return fromUrl.trim();
  const cookie = req.headers.get("cookie") || "";
  const match = cookie.match(new RegExp(`${AUTH_COOKIE}=([^;]+)`));
  if (match) {
    try {
      const parsed = JSON.parse(decodeURIComponent(match[1]));
      return parsed?.id || null;
    } catch { return null; }
  }
  if (isDevAuthBypassRequest(req)) return "finalent";
  return null;
}

function stateKey(userId: string | null): string {
  return userId ? `${STORAGE_KEY_BASE}:${userId}` : STORAGE_KEY_LEGACY;
}

function getEnv() {
  const base =
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    "";
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    "";
  return { base, token };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepMerge<T>(base: T, patch: Partial<T>): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return (patch as T) ?? base;
  }
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const cur = out[k];
    if (isPlainObject(cur) && isPlainObject(v)) {
      out[k] = deepMerge(cur, v);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

function mergePartialState(base: AppState, patch: Partial<AppState>, userId: string): AppState {
  const next: AppState = {
    ...base,
    ...patch,
    // 중첩 객체는 deep merge로 처리
    matchTimerEnabled: patch.matchTimerEnabled
      ? deepMerge(base.matchTimerEnabled, patch.matchTimerEnabled)
      : base.matchTimerEnabled,
    timerDisplayStyles: patch.timerDisplayStyles
      ? deepMerge(base.timerDisplayStyles, patch.timerDisplayStyles)
      : base.timerDisplayStyles,
    sigSalesMemberPresets: patch.sigSalesMemberPresets
      ? deepMerge(base.sigSalesMemberPresets, patch.sigSalesMemberPresets)
      : base.sigSalesMemberPresets,
  };

  // patch에 없는 필드가 undefined로 덮이지 않도록 보정
  if (!("members" in patch)) next.members = base.members;
  if (!("memberPositions" in patch)) next.memberPositions = base.memberPositions;
  if (!("memberPositionMode" in patch)) next.memberPositionMode = base.memberPositionMode;
  if (!("rankPositionLabels" in patch)) next.rankPositionLabels = base.rankPositionLabels;
  if (!("donorRankingsTheme" in patch)) next.donorRankingsTheme = base.donorRankingsTheme;
  if (!("donorRankingsPresets" in patch)) next.donorRankingsPresets = base.donorRankingsPresets;
  if (!("donorRankingsPresetId" in patch)) next.donorRankingsPresetId = base.donorRankingsPresetId;
  if (!("forbiddenWords" in patch)) next.forbiddenWords = base.forbiddenWords;
  if (!("missions" in patch)) next.missions = base.missions;
  if (!("sigInventory" in patch)) next.sigInventory = base.sigInventory;
  if (!("sigSoldOutStampUrl" in patch)) next.sigSoldOutStampUrl = base.sigSoldOutStampUrl;
  if (!("sigSalesExcludedIds" in patch)) next.sigSalesExcludedIds = base.sigSalesExcludedIds;
  if (!("overlayPresets" in patch)) next.overlayPresets = base.overlayPresets;
  if (!("overlaySettings" in patch)) next.overlaySettings = base.overlaySettings;
  if (!("sigMatch" in patch)) next.sigMatch = base.sigMatch;
  if (!("sigMatchSettings" in patch)) next.sigMatchSettings = base.sigMatchSettings;
  if (!("mealBattle" in patch)) next.mealBattle = base.mealBattle;
  if (!("mealMatch" in patch)) next.mealMatch = base.mealMatch;
  if (!("mealMatchSettings" in patch)) next.mealMatchSettings = base.mealMatchSettings;
  if (!("sigMatchTimer" in patch)) next.sigMatchTimer = base.sigMatchTimer;
  if (!("mealMatchTimer" in patch)) next.mealMatchTimer = base.mealMatchTimer;
  if (!("sigSalesTimer" in patch)) next.sigSalesTimer = base.sigSalesTimer;
  if (!("generalTimer" in patch)) next.generalTimer = base.generalTimer;
  if (!("donorRankingsOverlayConfig" in patch)) next.donorRankingsOverlayConfig = base.donorRankingsOverlayConfig;
  if (!("donationListsOverlayConfig" in patch)) next.donationListsOverlayConfig = base.donationListsOverlayConfig;

  // rouletteState는 /api/roulette/spin, /api/roulette/finish 전용으로 관리한다.
  // Edge 런타임에서는 인메모리 lock이 인스턴스 간 공유되지 않아 /api/state 저장과 경합할 수 있으므로
  // /api/state 경로에서 들어온 rouletteState는 "더 최신 startedAt"인 경우에만 제한적으로 반영한다.
  // 대부분의 일반 저장은 base를 유지해 스핀 상태 덮어쓰기를 방지한다.
  const baseStartedAt = Number(base.rouletteState?.startedAt || 0);
  const patchStartedAt = Number(patch.rouletteState?.startedAt || 0);
  const patchHasRollingFlag = typeof patch.rouletteState?.isRolling === "boolean";
  const canApplyPatchRouletteState =
    "rouletteState" in patch &&
    !isRouletteLocked(userId) &&
    Number.isFinite(patchStartedAt) &&
    (patchStartedAt > baseStartedAt || (patchStartedAt === baseStartedAt && patchHasRollingFlag));
  if (!canApplyPatchRouletteState) {
    next.rouletteState = base.rouletteState;
  }

  return next;
}

async function upstashGet(key: string) {
  const { base, token } = getEnv();
  if (!base || !token) return null;
  const url = `${base.replace(/\/$/, "")}/get/${encodeURIComponent(key)}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!r.ok) return null;
  const data = (await r.json()) as { result?: string | null };
  if (!data || data.result == null) return null;
  try {
    return JSON.parse(data.result as string);
  } catch {
    return null;
  }
}

async function upstashSet(key: string, value: unknown) {
  const { base, token } = getEnv();
  if (!base || !token) return false;
  const json = JSON.stringify(value);
  const url = `${base.replace(/\/$/, "")}/pipeline`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([["SET", key, json]]),
  });
  return r.ok;
}

export async function GET(req: Request) {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    const { base, token } = getEnv();
    if (!base || !token) {
      const state = getServerMemoryAppState() || defaultState();
      if (!getServerMemoryAppState()) {
        logger.warn('Redis 미설정 - 메모리만 사용 (서버 재시작 시 데이터 초기화됨. UPSTASH_REDIS_* 환경변수 설정 권장)');
      }
      logger.debug('메모리 상태 반환', { membersCount: state.members.length, donorsCount: state.donors.length });
      return new Response(JSON.stringify(state), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control":
            "no-store, max-age=0, s-maxage=0, stale-while-revalidate=0",
        },
      });
    }

    let state = await upstashGet(stateKey(userId));
    if (!state || !Array.isArray(state.members)) {
      if (isLegacyMigrationTargetUserId(userId)) {
        const legacy = await upstashGet(STORAGE_KEY_LEGACY);
        if (legacy && (Array.isArray(legacy.members) || Array.isArray(legacy.overlayPresets))) {
          await upstashSet(stateKey(userId), legacy);
          state = legacy;
          logger.info('기존 데이터 계정으로 마이그레이션', { userId });
        }
      }
    }
    // Redis에서 상태를 못 가져오더라도 방송 지속성을 위해 메모리/기본 상태 반환
    const effective = state || getServerMemoryAppState() || defaultState();
    if (!state && !getServerMemoryAppState()) {
      logger.warn('Redis/메모리 모두 비어있음 - 기본값 반환 (서버 재시작 시 발생. Redis 설정 권장)', { userId });
    }
    let mergedForResponse = effective as AppState;
    // Edge 런타임에서 상태 경합이 있을 수 있어, 룰렛 전용 저장소의 최신 rouletteState를 응답에 우선 반영
    // (spin 직후 오버레이가 회전 상태를 놓치지 않도록 보강)
    try {
      const rouletteStateSource = await loadAppStateForRoulette(userId);
      if (rouletteStateSource?.rouletteState) {
        const curStarted = Number((effective as AppState).rouletteState?.startedAt || 0);
        const rouletteStarted = Number(rouletteStateSource.rouletteState?.startedAt || 0);
        const shouldUseRouletteState =
          Boolean(rouletteStateSource.rouletteState?.isRolling) ||
          rouletteStarted >= curStarted;
        if (shouldUseRouletteState) {
          mergedForResponse = {
            ...(effective as AppState),
            rouletteState: rouletteStateSource.rouletteState,
          };
        }
      }
    } catch {}

    logger.debug('Redis 상태 반환', { hasState: !!state, usedMemory: !!getServerMemoryAppState(), userId });
    return new Response(JSON.stringify(mergedForResponse), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control":
          "no-store, max-age=0, s-maxage=0, stale-while-revalidate=0",
      },
    });
  } catch (error) {
    logger.error('상태 조회 실패', error);
    const fallback = getServerMemoryAppState() || defaultState();
    return new Response(JSON.stringify(fallback), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  }
}

export async function POST(req: Request) {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    const body = (await req.json()) as Partial<AppState>;
    const { base, token } = getEnv();
    let existing: AppState | null = null;
    if (base && token) {
      existing = await upstashGet(stateKey(userId)) as AppState | null;
    } else {
      existing = getServerMemoryAppState();
    }
    const baseState = existing || defaultState();
    const mergedDonors = Array.isArray(body.donors)
      ? mergeDonorsForMultiTabSave(body.donors || [], baseState.donors)
      : baseState.donors;
    const merged = mergePartialState(baseState, body, userId);
    const next: AppState = { ...merged, donors: mergedDonors, updatedAt: Date.now() };

    if (!base || !token) {
      setServerMemoryAppState(next);
      logger.info('메모리 상태 업데이트', { updatedAt: next.updatedAt });
      return new Response(JSON.stringify({ ok: true }), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control":
            "no-store, max-age=0, s-maxage=0, stale-while-revalidate=0",
        },
        status: 200,
      });
    }

    const ok = await upstashSet(stateKey(userId), next);
    logger.info('Redis 상태 업데이트', { updatedAt: next.updatedAt, success: ok, userId });
    // Redis 오류 시에도 방송 중단 방지를 위해 메모리에 저장 후 200 반환
    if (!ok) {
      setServerMemoryAppState(next);
      logger.warn('Redis 업데이트 실패로 메모리에 기록', { updatedAt: next.updatedAt, userId });
    } else {
      setServerMemoryAppState(next);
    }
    return new Response(JSON.stringify({ ok: true, fallback: ok ? undefined : "memory" }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control":
          "no-store, max-age=0, s-maxage=0, stale-while-revalidate=0",
      },
      status: 200,
    });
  } catch (error) {
    logger.error('상태 업데이트 실패', error);
    // 예외 발생 시에도 메모리에 저장 시도
    try {
      const body = (await req.json()) as AppState;
      const memNext = { ...body, updatedAt: Date.now() };
      setServerMemoryAppState(memNext);
      logger.warn('예외 발생으로 메모리에 기록', { updatedAt: memNext.updatedAt });
    } catch {}
    return new Response(JSON.stringify({ ok: true, fallback: "memory" }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  }
}
