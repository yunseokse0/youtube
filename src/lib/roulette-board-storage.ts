/**
 * Toontation 방식 일반 룰렛 보드 — 스토리지 (Upstash KV + 메모리 폴백)
 *
 * 정적 아이템(항목), 동적 슬롯(수동/후원), 룰렛 설정을 사용자별로 저장.
 */

import {
  isPersistentKvConfigured,
  upstashGetJson,
  upstashSetJsonWithSetPath,
} from "@/app/api/_shared/upstash";
import type {
  RouletteConfig,
  RouletteDynamicSlot,
  RouletteItem,
} from "@/lib/roulette-board";

const BOARD_KEY_PREFIX = "excel-broadcast-roulette-board-v1";

function boardKey(userId: string): string {
  return `${BOARD_KEY_PREFIX}:${userId}`;
}

export type BoardRouletteState = {
  config: RouletteConfig;
  items: RouletteItem[];
  dynamicSlots: RouletteDynamicSlot[];
  updatedAt: number;
};

const DEFAULT_BOARD: BoardRouletteState = {
  config: {
    streamerId: "",
    enabled: true,
    minAmount: 0,
    cutoffTimestamp: null,
    thresholdAmount: null,
    addSlotsPerThreshold: 1,
    currentRotationDeg: 0,
    updatedAt: 0,
  },
  items: [],
  dynamicSlots: [],
  updatedAt: 0,
};

/** 메모리 폴백 (KV 미설정 시) */
const memoryBoards = new Map<string, BoardRouletteState>();

/** 서버 저장 — KV 또는 메모리 */
export async function saveBoardRoulette(
  userId: string,
  state: BoardRouletteState
): Promise<boolean> {
  const next = { ...state, updatedAt: Date.now() };
  if (isPersistentKvConfigured()) {
    try {
      await upstashSetJsonWithSetPath(boardKey(userId), next);
      return true;
    } catch {
      /* 폴백 메모리 */
    }
  }
  memoryBoards.set(userId, next);
  return true;
}

/** 서버 로드 — KV 또는 메모리 */
export async function loadBoardRoulette(
  userId: string
): Promise<BoardRouletteState> {
  if (isPersistentKvConfigured()) {
    try {
      const remote = await upstashGetJson<BoardRouletteState>(boardKey(userId));
      if (remote && Array.isArray(remote.items)) {
        return remote;
      }
    } catch {
      /* 폴백 메모리 */
    }
  }
  const mem = memoryBoards.get(userId);
  if (mem) return mem;
  return { ...DEFAULT_BOARD, config: { ...DEFAULT_BOARD.config, streamerId: userId } };
}

/** 특정 필드만 패치 저장 */
export async function patchBoardRoulette(
  userId: string,
  patch: Partial<BoardRouletteState>
): Promise<BoardRouletteState> {
  const current = await loadBoardRoulette(userId);
  const next: BoardRouletteState = {
    ...current,
    ...patch,
    updatedAt: Date.now(),
    config: { ...current.config, ...(patch.config || {}), updatedAt: Date.now() },
  };
  await saveBoardRoulette(userId, next);
  return next;
}

/** 동적 슬롯 전체 삭제(판 초기화 시) */
export async function clearBoardDynamicSlots(userId: string): Promise<boolean> {
  const current = await loadBoardRoulette(userId);
  return saveBoardRoulette(userId, {
    ...current,
    dynamicSlots: [],
    updatedAt: Date.now(),
  });
}
