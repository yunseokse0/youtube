export const revalidate = 0;

import type { AppState } from "@/lib/state";
import { defaultState } from "@/lib/state";
import { getServerMemoryAppState, setServerMemoryAppState } from "@/lib/server-memory-app-state";
import { getUserIdFromRequest } from "../../_shared/user-id";
import { getRedisEnv } from "../../_shared/upstash";
import { upstashGetAppStateJson, upstashSetAppStateJson } from "../../_shared/upstash-app-state";
import {
  computeEscalatedDonationGoal,
  DEFAULT_DONATION_GOAL,
  isDonationGoalAutoEscalateEnabled,
} from "@/lib/goal-preset-math";

const STORAGE_KEY_BASE = "excel-broadcast-state-v1";

function stateKey(userId: string): string {
  return `${STORAGE_KEY_BASE}:${userId}`;
}

function presetShowsDonationGoal(p: Record<string, unknown>): boolean {
  return p.showGoal === true || p.showGoal === "true" || p.showGoal === 1 || p.showGoal === "1";
}

function parseGoalAmount(raw: unknown): number {
  const v = String(raw ?? "").trim().replace(/,/g, "");
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
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
    const liveTotal = Math.max(0, Math.floor(Number(body.liveTotal || 0)));
    const presetId = String(body.presetId || "").trim();

    const state = await loadState(userId);
    const presets = Array.isArray(state.overlayPresets) ? [...state.overlayPresets] : [];
    if (!presets.length) {
      return Response.json({ ok: true, skipped: true, reason: "no_presets" }, { status: 200, headers: { "Content-Type": "application/json" } });
    }

    let targetIndex = presetId ? presets.findIndex((raw) => String((raw as Record<string, unknown>)?.id || "") === presetId) : -1;
    if (targetIndex < 0) {
      targetIndex = presets.findIndex((raw) => presetShowsDonationGoal(raw as Record<string, unknown>));
    }
    if (targetIndex < 0) targetIndex = 0;

    const row = presets[targetIndex] as Record<string, unknown>;
    const currentGoal = Math.max(DEFAULT_DONATION_GOAL, parseGoalAmount(row?.goal));
    if (liveTotal < currentGoal) {
      return Response.json(
        { ok: true, skipped: true, goal: currentGoal, liveTotal },
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    const nextGoal = computeEscalatedDonationGoal(currentGoal, liveTotal);
    if (nextGoal <= currentGoal) {
      return Response.json(
        { ok: true, skipped: true, goal: currentGoal, liveTotal },
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    presets[targetIndex] = {
      ...row,
      goal: String(nextGoal),
      goalBaseline: String(row?.goalBaseline ?? DEFAULT_DONATION_GOAL),
    };

    const next: AppState = {
      ...state,
      overlayPresets: presets as AppState["overlayPresets"],
      updatedAt: Date.now(),
    };
    await saveState(userId, next);

    return Response.json(
      { ok: true, goal: nextGoal, previousGoal: currentGoal, liveTotal, presetId: String(row?.id || presetId || "") },
      { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return Response.json(
      { ok: false, error: String(e) },
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
