import { saveAppStateForRoulette } from "@/app/api/roulette/edge-state-store";
import { loadAppStateForUserId } from "@/lib/app-state-server-load";
import {
  contributionFormulasEqual,
  normalizeContributionFormula,
} from "@/lib/contribution-formula";
import { publishSseEvent } from "@/lib/sse-clients-hub";
import type { ContributionFormula } from "@/types";

/** 기여도 계산식만 서버 state에 저장 — donors·멤버 합산은 유지 */
export async function persistContributionFormulaForUser(
  userId: string,
  formula: ContributionFormula
): Promise<{ ok: true; formula: ContributionFormula } | { ok: false }> {
  const uid = String(userId || "").trim();
  if (!uid) return { ok: false };
  const normalized = normalizeContributionFormula(formula);
  const state = await loadAppStateForUserId(uid);
  if (!state) return { ok: false };
  if (contributionFormulasEqual(state.contributionFormula, normalized)) {
    return { ok: true, formula: normalized };
  }
  const now = Date.now();
  const next = { ...state, contributionFormula: normalized, updatedAt: now };
  const saved = await saveAppStateForRoulette(uid, next);
  if (!saved.ok) return { ok: false };
  await publishSseEvent({ type: "state_updated", updatedAt: saved.state.updatedAt });
  return { ok: true, formula: normalized };
}
