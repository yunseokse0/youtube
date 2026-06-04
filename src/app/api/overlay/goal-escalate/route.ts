export const revalidate = 0;

import type { AppState } from "@/lib/state";
import { defaultState } from "@/lib/state";
import { getServerMemoryAppState, setServerMemoryAppState } from "@/lib/server-memory-app-state";
import { getUserIdFromRequest } from "../../_shared/user-id";
import { getRedisEnv } from "../../_shared/upstash";
import { upstashGetAppStateJson, upstashSetAppStateJson } from "../../_shared/upstash-app-state";
import {
  applyDonationGoalEscalationToState,
  computeLiveDonationTotalFromMembers,
  isDonationGoalAutoEscalateEnabled,
} from "@/lib/goal-preset-math";

const STORAGE_KEY_BASE = "excel-broadcast-state-v1";

function stateKey(userId: string): string {
  return `${STORAGE_KEY_BASE}:${userId}`;
}

async function loadState(userId: string): Promise<AppState> {
  const { base, token } = getRedisEnv();
  if (base && token) {
    const remote = await upstashGetAppStateJson<AppState>(stateKey(userId));
    if (remote && Array.isArray(remote.members)) return remote;
  }
  const mem = getServerMemoryAppState();
  if (mem && Array.isArray(mem.members)) return mem;
  return defaultState();
}

async function saveState(userId: string, next: AppState): Promise<void> {
  const { base, token } = getRedisEnv();
  setServerMemoryAppState(next);
  if (base && token) {
    await upstashSetAppStateJson(stateKey(userId), next);
  }
}

export async function POST(req: Request) {
  try {
    if (!isDonationGoalAutoEscalateEnabled()) {
      return Response.json({ ok: true, skipped: true }, { status: 200, headers: { "Content-Type": "application/json" } });
    }
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Content-Type": "application/json" } });
    }
    let body: { presetId?: string; liveTotal?: number } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return Response.json({ error: "invalid_body" }, { status: 400, headers: { "Content-Type": "application/json" } });
    }
    const presetId = String(body.presetId || "").trim();
    const bodyLive = Math.max(0, Math.floor(Number(body.liveTotal || 0)));

    const state = await loadState(userId);
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

    await saveState(userId, next);

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
