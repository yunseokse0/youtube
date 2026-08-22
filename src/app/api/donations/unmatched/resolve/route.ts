export const runtime = "nodejs";
export const revalidate = 0;

import { resolveWriteUserId, writeUserIdErrorResponse } from "@/app/api/_shared/user-id";
import { readUnmatchedDonations, writeUnmatchedDonations } from "../../_shared/unmatched-store";

export async function POST(req: Request) {
  const writeUid = resolveWriteUserId(req);
  if (!writeUid.ok) return writeUserIdErrorResponse(writeUid);
  const userId = writeUid.userId;
  const body = (await req.json().catch(() => null)) as { id?: string } | null;
  const id = String(body?.id || "").trim();
  if (!id) {
    return new Response(JSON.stringify({ error: "invalid_id" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const list = await readUnmatchedDonations(userId);
  const next = list.filter((x) => x.id !== id);
  await writeUnmatchedDonations(userId, next);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
}
