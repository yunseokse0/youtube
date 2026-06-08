export const runtime = "edge";
export const revalidate = 0;

import { getUserIdFromRequest } from "@/app/api/_shared/user-id";
import type { DonationEvent, QueueSigItem } from "@/lib/donation/types";
import { readDonationQueue, writeDonationQueue } from "../_shared/queue-store";

function sanitizeEvent(raw: unknown): DonationEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const x = raw as Record<string, unknown>;
  const id = String(x.id || "").trim();
  const externalId = String(x.externalId || "").trim();
  const donorName = String(x.donorName || "").trim();
  const provider = x.provider === "bank" ? "bank" : "toonation";
  const amount = Math.max(0, Math.round(Number(x.amount || 0)));
  if (!id || !externalId || !donorName || amount <= 0) return null;
  const sigListSnapshotRaw = Array.isArray(x.sigListSnapshot) ? x.sigListSnapshot : [];
  const sigListSnapshot: QueueSigItem[] = sigListSnapshotRaw
    .filter((v) => v && typeof v === "object")
    .map((v) => {
      const t = v as Record<string, unknown>;
      return {
        id: String(t.id || "").trim(),
        name: String(t.name || "").trim() || "이름없음",
        price: Math.max(0, Math.round(Number(t.price || 0))),
        isActive: Boolean(t.isActive),
        soldCount: Number.isFinite(Number(t.soldCount)) ? Math.max(0, Math.floor(Number(t.soldCount))) : undefined,
        maxCount: Number.isFinite(Number(t.maxCount)) ? Math.max(0, Math.floor(Number(t.maxCount))) : undefined,
      };
    })
    .filter((s) => s.id);

  return {
    id,
    provider,
    externalId,
    donorName,
    amount,
    message: typeof x.message === "string" ? x.message : "",
    playerName: typeof x.playerName === "string" ? x.playerName.trim() : undefined,
    recipientName: typeof x.recipientName === "string" ? x.recipientName.trim() : undefined,
    at: String(x.at || new Date().toISOString()),
    target: x.target === "account" ? "account" : "toon",
    status: "queued",
    memberId: typeof x.memberId === "string" ? x.memberId : undefined,
    memberAutoAssigned: x.memberAutoAssigned === true ? true : undefined,
    alreadyApplied: x.alreadyApplied === true ? true : undefined,
    error: typeof x.error === "string" ? x.error : undefined,
    sigListSnapshot,
  };
}

export async function GET(req: Request) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const items = await readDonationQueue(userId);
  return new Response(JSON.stringify({ items }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function POST(req: Request) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const body = await req.json().catch(() => null);
  const event = sanitizeEvent(body);
  if (!event) {
    return new Response(JSON.stringify({ error: "invalid_event" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const list = await readDonationQueue(userId);
  const withoutDup = list.filter((x) => x.id !== event.id);
  await writeDonationQueue(userId, [event, ...withoutDup]);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
}

export async function DELETE(req: Request) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const body = (await req.json().catch(() => null)) as { id?: string; clearAll?: boolean } | null;
  const id = String(body?.id || "").trim();
  const clearAll = Boolean(body?.clearAll);
  const list = await readDonationQueue(userId);
  const next = clearAll ? [] : list.filter((x) => x.id !== id);
  await writeDonationQueue(userId, next);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
}
