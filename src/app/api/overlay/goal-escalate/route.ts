export const revalidate = 0;

import type { AppState } from "@/lib/state";
import { defaultState } from "@/lib/state";
import { getServerMemoryAppState, setServerMemoryAppState } from "@/lib/server-memory-app-state";
import { resolveWriteUserId } from "../../_shared/user-id";
import { isPersistentKvConfigured } from "../../_shared/upstash";
import { upstashSetAppStateJson } from "../../_shared/upstash-app-state";
import { loadAppStateForUserId, seedAppStateKvCache } from "@/lib/app-state-server-load";
import {
  applyDonationGoalEscalationToState,
  computeLiveDonationTotalFromMembers,
  isDonationGoalAutoEscalateEnabled,
} from "@/lib/goal-preset-math";

const STORAGE_KEY_BASE = "excel-broadcast-state-v1";

function stateKey(userId: string): string {
  return `${STORAGE_KEY_BASE}:${userId}`;
}

/**
 * 목표 상향은 통째 저장이라, 저장 직전 메모리(정본)에 다시 적용해야 한다.
 * MySQL 본을 그대로 쓰면 메모리엔 들어왔지만 아직 MySQL 에 안 쓰인 후원이 사라진다.
 */
async function warmState(userId: string): Promise<AppState> {
  const loaded = await loadAppStateForUserId(userId).catch(() => null);
  if (loaded && Array.isArray(loaded.members)) return loaded;
  const mem = getServerMemoryAppState(userId);
  if (mem && Array.isArray(mem.members)) return mem;
  return defaultState();
}

async function saveState(userId: string, next: AppState): Promise<boolean> {
  setServerMemoryAppState(userId, next);
  seedAppStateKvCache(userId, next);
  if (!isPersistentKvConfigured()) return true;
  return upstashSetAppStateJson(stateKey(userId), next);
}

export async function POST(req: Request) {
  try {
    if (!isDonationGoalAutoEscalateEnabled()) {
      return Response.json({ ok: true, skipped: true }, { status: 200, headers: { "Content-Type": "application/json" } });
    }
    const writeUid = resolveWriteUserId(req, { allowAnonymousUrlUser: true });
    if (!writeUid.ok) {
      return Response.json(
        { ok: false, error: writeUid.error },
        { status: writeUid.status, headers: { "Content-Type": "application/json" } }
      );
    }
    const userId = writeUid.userId;
    let body: { presetId?: string; liveTotal?: number } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return Response.json({ error: "invalid_body" }, { status: 400, headers: { "Content-Type": "application/json" } });
    }
    const presetId = String(body.presetId || "").trim();
    const bodyLive = Math.max(0, Math.floor(Number(body.liveTotal || 0)));

    const warmed = await warmState(userId);
    /** await 없이 바로 아래에서 next 를 만들고 메모리에 쓴다 — 그 사이 들어온 후원을 덮지 않게 */
    const state = getServerMemoryAppState(userId) ?? warmed;
    const memberLive = computeLiveDonationTotalFromMembers(state.members);
    const liveTotal = Math.max(bodyLive, memberLive);
    const beforeRow = (state.overlayPresets || []).find((raw) => {
      const p = raw as Record<string, unknown>;
      if (presetId) return String(p.id || "") === presetId;
      return p.showGoal === true || p.showGoal === "true" || p.showGoal === 1 || p.showGoal === "1";
    }) as Record<string, unknown> | undefined;
    const beforeGoal = String(beforeRow?.goal ?? "0");

    const next = applyDonationGoalEscalationToState(state);
    const afterRow = (next.overlayPresets || []).find((raw) => {
      const p = raw as Record<string, unknown>;
      if (presetId) return String(p.id || "") === presetId;
      return p.showGoal === true || p.showGoal === "true" || p.showGoal === 1 || p.showGoal === "1";
    }) as Record<string, unknown> | undefined;
    const afterGoal = String(afterRow?.goal ?? beforeGoal);

    if (afterGoal === beforeGoal) {
      return Response.json(
        { ok: true, skipped: true, goal: Number(beforeGoal) || 0, liveTotal },
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    const wrote = await saveState(userId, next);
    if (!wrote) {
      return Response.json(
        { ok: false, error: "persist_failed" },
        { status: 503, headers: { "Content-Type": "application/json" } }
      );
    }

    return Response.json(
      {
        ok: true,
        goal: Number(afterGoal) || 0,
        previousGoal: Number(beforeGoal) || 0,
        liveTotal,
        presetId: String(afterRow?.id || presetId || ""),
      },
      { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return Response.json(
      { ok: false, error: String(e) },
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
