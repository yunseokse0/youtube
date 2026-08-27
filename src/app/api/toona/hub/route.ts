import { NextRequest } from "next/server";
import { resolveWriteUserId, writeUserIdErrorResponse } from "@/app/api/_shared/user-id";
import {
  fetchToonaDonationsSinceLink,
  getYoutubePublicBaseUrl,
  loginAndLinkToonaHub,
  refreshToonaHubStatus,
  syncContributionFormulaToToonaHub,
} from "@/lib/toona-hub-client";
import {
  clearToonaHubDonationLogs,
  clearToonaHubSession,
  publicToonaHubSession,
  readToonaHubDonationLogs,
  readToonaHubSession,
} from "@/lib/toona-hub-session";
import { normalizeContributionFormula } from "@/lib/contribution-formula";
import { loadAppStateForUserId } from "@/lib/app-state-server-load";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store, max-age=0" },
  });
}

/** GET — 허브 세션 상태 + 로그인 이후 후원 로그 */
export async function GET(req: NextRequest) {
  const auth = resolveWriteUserId(req);
  if (!auth.ok) return writeUserIdErrorResponse(auth);

  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  if (refresh) {
    const synced = await refreshToonaHubStatus(auth.userId);
    await fetchToonaDonationsSinceLink(auth.userId);
    const logs = await readToonaHubDonationLogs(auth.userId);
    return json({ ok: true, session: synced.session, logs });
  }

  const session = await readToonaHubSession(auth.userId);
  const logs = await readToonaHubDonationLogs(auth.userId);
  return json({ ok: true, session: publicToonaHubSession(session), logs });
}

/** POST — toona 로그인 + youtubegit 연동 */
export async function POST(req: NextRequest) {
  const auth = resolveWriteUserId(req);
  if (!auth.ok) return writeUserIdErrorResponse(auth);

  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    baseUrl?: string;
    action?: string;
    contributionFormula?: unknown;
  };

  if (body.action === "sync-donations") {
    const result = await fetchToonaDonationsSinceLink(auth.userId);
    if (!result.ok) return json({ ok: false, error: result.error }, 502);
    const logs = await readToonaHubDonationLogs(auth.userId);
    const session = await readToonaHubSession(auth.userId);
    return json({
      ok: true,
      imported: result.imported,
      session: publicToonaHubSession(session),
      logs,
    });
  }

  if (body.action === "sync-contribution-formula") {
    const formula = normalizeContributionFormula(body.contributionFormula);
    const result = await syncContributionFormulaToToonaHub(auth.userId, formula);
    if (!result.ok) {
      const status = result.error === "hub_not_linked" ? 409 : 502;
      return json({ ok: false, error: result.error }, status);
    }
    return json({ ok: true, formula });
  }

  const result = await loginAndLinkToonaHub({
    youtubeUserId: auth.userId,
    email: String(body.email || ""),
    password: String(body.password || ""),
    baseUrl: body.baseUrl,
    youtubePublicBaseUrl: getYoutubePublicBaseUrl(req),
  });

  if (!result.ok) {
    const status =
      result.error.includes("login_failed") || result.error.includes("비밀번호") || result.error.includes("이메일")
        ? 401
        : 502;
    return json({ ok: false, error: result.error }, status);
  }

  /** 연동 직후 현재 기여도 공식도 toona에 맞춤 (도네 얼럿용) */
  const state = await loadAppStateForUserId(auth.userId);
  const formula = normalizeContributionFormula(
    body.contributionFormula ?? state?.contributionFormula
  );
  await syncContributionFormulaToToonaHub(auth.userId, formula);

  return json({ ok: true, session: result.session, logs: [] });
}

/** DELETE — 허브 로그아웃(세션·로그 삭제, toona 측 설정은 유지) */
export async function DELETE(req: NextRequest) {
  const auth = resolveWriteUserId(req);
  if (!auth.ok) return writeUserIdErrorResponse(auth);
  await clearToonaHubSession(auth.userId);
  await clearToonaHubDonationLogs(auth.userId);
  return json({ ok: true });
}
