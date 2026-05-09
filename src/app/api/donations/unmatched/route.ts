export const runtime = "edge";
export const revalidate = 0;

import { getUserIdFromRequest } from "@/app/api/_shared/user-id";
import { readUnmatchedDonations, writeUnmatchedDonations } from "../_shared/unmatched-store";
import type { DonationEvent } from "@/lib/donation/types";

function sanitizeEvent(raw: unknown): DonationEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const x = raw as Record<string, unknown>;
  const id = String(x.id || "").trim();
  const donorName = String(x.donorName || "").trim();
  const externalId = String(x.externalId || "").trim();
  const provider = x.provider === "bank" ? "bank" : "toonation";
  const amount = Math.max(0, Math.round(Number(x.amount || 0)));
  if (!id || !externalId || !donorName || amount <= 0) return null;
  return {
    id,
    provider,
    externalId,
    donorName,
    amount,
    message: String(x.message || ""),
    at: String(x.at || new Date().toISOString()),
    target: x.target === "account" ? "account" : "toon",
    status: "unmatched",
    memberId: typeof x.memberId === "string" ? x.memberId : undefined,
    error: typeof x.error === "string" ? x.error : undefined,
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
  const list = await readUnmatchedDonations(userId);
  return new Response(JSON.stringify({ items: list }), {
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
  const list = await readUnmatchedDonations(userId);
  const withoutDup = list.filter((x) => x.id !== event.id);
  const next = [event, ...withoutDup];
  await writeUnmatchedDonations(userId, next);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
}
