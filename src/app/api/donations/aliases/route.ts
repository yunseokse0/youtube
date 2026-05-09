export const runtime = "edge";
export const revalidate = 0;

import { getUserIdFromRequest } from "@/app/api/_shared/user-id";
import type { DonorAlias } from "@/lib/donation/types";
import { readDonationAliases, writeDonationAliases } from "../_shared/alias-store";

function normalizeAlias(raw: unknown): string {
  return String(raw || "").trim();
}

export async function GET(req: Request) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }
  const items = await readDonationAliases(userId);
  return new Response(JSON.stringify({ items }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function POST(req: Request) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }
  const body = (await req.json().catch(() => null)) as { alias?: string; memberId?: string } | null;
  const alias = normalizeAlias(body?.alias);
  const memberId = String(body?.memberId || "").trim();
  if (!alias || !memberId) {
    return new Response(JSON.stringify({ error: "invalid_payload" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  const list = await readDonationAliases(userId);
  const nextItem: DonorAlias = { alias, memberId };
  const withoutDup = list.filter((x) => x.alias !== alias);
  await writeDonationAliases(userId, [nextItem, ...withoutDup]);
  return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
}

export async function DELETE(req: Request) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }
  const body = (await req.json().catch(() => null)) as { alias?: string } | null;
  const alias = normalizeAlias(body?.alias);
  if (!alias) {
    return new Response(JSON.stringify({ error: "invalid_alias" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  const list = await readDonationAliases(userId);
  await writeDonationAliases(userId, list.filter((x) => x.alias !== alias));
  return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
}
