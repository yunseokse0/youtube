import { NextRequest } from "next/server";
import { verifyToonaIngestAuth } from "@/app/api/donations/_shared/toona-ingest-auth";
import { normalizeContributionFormula } from "@/lib/contribution-formula";
import { persistContributionFormulaForUser } from "@/lib/contribution-formula-persist";
import { loadAppStateForUserId } from "@/lib/app-state-server-load";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store, max-age=0" },
  });
}

/** GET — toona S2S: 현재 기여도 계산식 (도네 얼럿 동기화용) */
export async function GET(req: NextRequest) {
  const auth = verifyToonaIngestAuth(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  const userId = new URL(req.url).searchParams.get("u")?.trim();
  if (!userId) return json({ error: "user_id_required" }, 400);

  const state = await loadAppStateForUserId(userId);
  const formula = normalizeContributionFormula(state?.contributionFormula);

  return json({ ok: true, userId, formula });
}

/** POST — toona S2S: 기여도 계산식을 youtube state에 저장 (toona → youtube 동기화) */
export async function POST(req: NextRequest) {
  const auth = verifyToonaIngestAuth(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  const userId = new URL(req.url).searchParams.get("u")?.trim();
  if (!userId) return json({ error: "user_id_required" }, 400);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const formula = normalizeContributionFormula(body.formula ?? body);
  const saved = await persistContributionFormulaForUser(userId, formula);
  if (!saved.ok) return json({ error: "save_failed" }, 500);

  return json({ ok: true, userId, formula: saved.formula });
}
