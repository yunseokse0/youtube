export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/app/api/_shared/user-id";
import { upstashGetJson, upstashSetJsonWithPipeline } from "@/app/api/_shared/upstash";

type ShangliuMember = { name: string; color: string; cm: number };
type ShangliuState = {
  mode: "team" | "individual";
  activeOrder: string[];
  members: Record<string, ShangliuMember>;
  updatedAt: number;
};

/** 후원 AppState와 분리된 영토 전용 키 */
function shangliuKey(userId: string): string {
  return `shangliu-territory-v1:${userId}`;
}

const memStore = new Map<string, ShangliuState>();

function clampCm(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1_000_000, n));
}

function sanitizeState(raw: unknown): ShangliuState | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const mode = o.mode === "team" ? "team" : "individual";
  const membersIn = o.members && typeof o.members === "object" && !Array.isArray(o.members)
    ? (o.members as Record<string, unknown>)
    : {};
  const members: Record<string, ShangliuMember> = {};
  for (const [id, row] of Object.entries(membersIn)) {
    if (!/^[A-Z]$/.test(id) || !row || typeof row !== "object") continue;
    const m = row as Record<string, unknown>;
    members[id] = {
      name: String(m.name || id).slice(0, 40),
      color: /^#[0-9a-fA-F]{6}$/.test(String(m.color || "")) ? String(m.color) : "#888888",
      cm: clampCm(m.cm),
    };
  }
  const ids = Object.keys(members);
  if (ids.length < 2 || ids.length > 6) return null;
  const orderRaw = Array.isArray(o.activeOrder) ? o.activeOrder.map((x) => String(x)) : ids;
  const activeOrder = orderRaw.filter((id, i, arr) => members[id] && arr.indexOf(id) === i);
  return {
    mode,
    members,
    activeOrder,
    updatedAt: Date.now(),
  };
}

async function loadState(userId: string): Promise<ShangliuState | null> {
  const fromKv = await upstashGetJson<ShangliuState>(shangliuKey(userId));
  if (fromKv && typeof fromKv === "object") {
    const cleaned = sanitizeState(fromKv);
    if (cleaned) {
      cleaned.updatedAt = Number(fromKv.updatedAt) || cleaned.updatedAt;
      memStore.set(userId, cleaned);
      return cleaned;
    }
  }
  return memStore.get(userId) || null;
}

export async function GET(req: Request) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ ok: false, error: "user_required" }, { status: 400 });
  }
  const state = await loadState(userId);
  return NextResponse.json(
    { ok: true, userId, state: state || null, updatedAt: state?.updatedAt || 0 },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function PUT(req: Request) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ ok: false, error: "user_required" }, { status: 400 });
  }
  const body = (await req.json().catch(() => null)) as { state?: unknown } | null;
  const next = sanitizeState(body?.state);
  if (!next) {
    return NextResponse.json({ ok: false, error: "invalid_state" }, { status: 400 });
  }
  memStore.set(userId, next);
  const persisted = await upstashSetJsonWithPipeline(shangliuKey(userId), next);
  return NextResponse.json(
    { ok: true, userId, updatedAt: next.updatedAt, persisted },
    { headers: { "Cache-Control": "no-store" } }
  );
}
