export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { resolveWriteUserId, writeUserIdErrorResponse, getUserIdFromRequest } from "@/app/api/_shared/user-id";
import {
  DONATION_INTAKE_MODE_A,
  DONATION_INTAKE_MODE_B,
  describeDonationIntakeModeShort,
  describeRuntimeDonationIntakeModeByMode,
  getRuntimeDonationIntakeMode,
  setRuntimeDonationIntakeMode,
  type DonationIntakeMode,
} from "@/policies/donation-intake-mode";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store, max-age=0" },
  });
}

/**
 * A·B 모드 관리자 헤더 전용 API
 *
 * GET  /api/settings/intake-mode
 *     → 현재 KV 저장된 Runtime 모드 + env fallback 리턴
 *
 * POST /api/settings/intake-mode
 *     Body: { mode: "A" | "B" }
 *     → KV 저장 + 해당 유저 리스너/폴러 런타임 즉시 스위치 (재시작 필요 X)
 */

export async function GET(req: Request) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return json({ error: "unauthorized" }, 401);
  try {
    const mode = await getRuntimeDonationIntakeMode(userId);
    return json({
      ok: true,
      userId,
      mode,
      short: describeDonationIntakeModeShort(mode),
      description: describeRuntimeDonationIntakeModeByMode(mode),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "read_failed";
    return json({ error: message }, 500);
  }
}

export async function POST(req: Request) {
  const uid = resolveWriteUserId(req);
  if (!uid.ok) return writeUserIdErrorResponse(uid);
  const userId = uid.userId;

  let body: { mode?: unknown } | null = null;
  try { body = (await req.json().catch(() => null)) as { mode?: unknown } | null; } catch { body = null; }

  const modeRaw = String(body?.mode ?? "").trim().toUpperCase();
  let mode: DonationIntakeMode;
  if (modeRaw === "A") mode = DONATION_INTAKE_MODE_A;
  else if (modeRaw === "B") mode = DONATION_INTAKE_MODE_B;
  else return json({ error: "invalid_mode (must be 'A' or 'B')" }, 400);

  try {
    const saved = await setRuntimeDonationIntakeMode(userId, mode);
    /** Safety Net: 영구 저장(KV) 실패여도 applyRuntime은 반드시 실행
     *  → 현 프로세스에서 리스너/폴러 전환이 적용돼야 라이브 중 후원 수집이 끊기지 않음
     *  → 응답에 `saved` flag 별도로 넣어서 프론트가 "일시 적용" 경고 토스트 띄울 수 있게
     */
    const { applyRuntimeDonationIntakeMode } = await import("@/lib/donation/runtime-intake-mode-switch");
    const applied = await applyRuntimeDonationIntakeMode(userId, mode).catch((e) => ({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }));

    if (!saved && !("ok" in applied && applied.ok)) {
      /** 저장 + 적용 둘 다 실패시에만 500 */
      return json({
        ok: false,
        error: "apply_and_save_failed",
        saved: false,
      }, 500);
    }

    return json({
      ok: true,
      userId,
      mode,
      saved,
      short: describeDonationIntakeModeShort(mode),
      description: describeRuntimeDonationIntakeModeByMode(mode),
      applied: "ok" in applied && applied.ok ? true : false,
      appliedDetail: applied,
      permanent: saved,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "write_failed";
    return json({ ok: false, error: message }, 500);
  }
}
