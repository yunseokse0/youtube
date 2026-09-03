import { NextRequest } from "next/server";
import { resolveWriteUserId, writeUserIdErrorResponse } from "@/app/api/_shared/user-id";
import {
  fetchToonaDonationsSinceLink,
  fetchToonaHubContributionFormula,
  fetchToonaSignaturesViaHubSession,
  getYoutubePublicBaseUrl,
  loginAndLinkToonaHub,
  pollToonaHubForAdmin,
  syncContributionFormulaToToonaHub,
} from "@/lib/toona-hub-client";
import {
  clearToonaHubDonationLogs,
  clearToonaHubSession,
  publicToonaHubSession,
  readToonaHubDonationLogs,
  readToonaHubSession,
} from "@/lib/toona-hub-session";
import { defaultState } from "@/lib/state";
import { normalizeContributionFormula } from "@/lib/contribution-formula";
import { persistContributionFormulaForUser } from "@/lib/contribution-formula-persist";
import { loadAppStateForUserId } from "@/lib/app-state-server-load";
import { applyToonaSigItemsToInventory } from "@/lib/toona-sig-import";
import { saveAppStateForRoulette } from "@/app/api/roulette/edge-state-store";
import { publishSseEvent } from "@/lib/sse-clients-hub";
import type { SigItem } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store, max-age=0" },
  });
}

async function importSigsAfterHubLogin(userId: string): Promise<{
  ok: boolean;
  count: number;
  added?: number;
  updated?: number;
  error?: string;
  items?: SigItem[];
  saved?: boolean;
}> {
  const fetched = await fetchToonaSignaturesViaHubSession(userId);
  if (!fetched.ok) return { ok: false, count: 0, error: fetched.error };
  const state = (await loadAppStateForUserId(userId)) ?? defaultState();
  const { nextInventory, added, updated } = applyToonaSigItemsToInventory(
    state.sigInventory || [],
    fetched.items,
    "merge"
  );
  const next = { ...state, sigInventory: nextInventory, updatedAt: Date.now() };
  const saved = await saveAppStateForRoulette(userId, next, { donorsMode: "add" });
  if (!saved.ok) {
    return {
      ok: false,
      count: fetched.count,
      added,
      updated,
      error: "sig_inventory_save_failed",
      items: fetched.items,
      saved: false,
    };
  }
  await publishSseEvent({ type: "state_updated", updatedAt: next.updatedAt });
  return {
    ok: true,
    count: fetched.count,
    added,
    updated,
    items: fetched.items,
    saved: true,
  };
}

/** GET — 허브 세션 상태 + 로그인 이후 후원 로그 */
export async function GET(req: NextRequest) {
  const auth = resolveWriteUserId(req);
  if (!auth.ok) return writeUserIdErrorResponse(auth);

  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  if (refresh) {
    const polled = await pollToonaHubForAdmin(auth.userId);
    return json({ ok: true, session: polled.session, logs: polled.logs });
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
      applied: result.applied,
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

  if (body.action === "import-signatures") {
    const imported = await importSigsAfterHubLogin(auth.userId);
    if (!imported.ok) {
      const status = imported.error === "hub_not_linked" ? 409 : 502;
      return json({ ok: false, error: imported.error }, status);
    }
    return json({
      ok: true,
      count: imported.count,
      added: imported.added,
      updated: imported.updated,
      items: imported.items,
    });
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

  /**
   * 연동 성공 응답은 빠르게 반환한다.
   * 기여도 동기화·시그 병합은 AppState 저장(대용량 donors)에 막혀
   * 「연결 중…」이 무한히 유지되는 원인이었음 → 짧은 예산 후 deferred.
   */
  type SigImportPayload = {
    ok: boolean;
    count: number;
    added: number;
    updated: number;
    error?: string;
  };
  const deferredSig: SigImportPayload = {
    ok: false,
    count: 0,
    added: 0,
    updated: 0,
    error: "deferred",
  };

  const postLinkWork = (async (): Promise<SigImportPayload> => {
    const state = await loadAppStateForUserId(auth.userId);
    let formula = normalizeContributionFormula(
      body.contributionFormula ?? state?.contributionFormula
    );
    if (body.contributionFormula) {
      await persistContributionFormulaForUser(auth.userId, formula);
    } else {
      const fromToona = await fetchToonaHubContributionFormula(auth.userId);
      if (fromToona) {
        formula = fromToona;
        await persistContributionFormulaForUser(auth.userId, fromToona);
      }
    }
    await syncContributionFormulaToToonaHub(auth.userId, formula);
    const sigImport = await importSigsAfterHubLogin(auth.userId);
    return {
      ok: sigImport.ok,
      count: sigImport.count,
      added: sigImport.added ?? 0,
      updated: sigImport.updated ?? 0,
      error: sigImport.error,
    };
  })();

  const POST_LINK_BUDGET_MS = 10_000;
  let sigImport: SigImportPayload = deferredSig;
  try {
    sigImport = await Promise.race([
      postLinkWork,
      new Promise<SigImportPayload>((resolve) =>
        setTimeout(() => resolve(deferredSig), POST_LINK_BUDGET_MS)
      ),
    ]);
  } catch (err) {
    sigImport = {
      ok: false,
      count: 0,
      added: 0,
      updated: 0,
      error: err instanceof Error ? err.message : "post_link_failed",
    };
  }
  /** race로 먼저 빠져도 백그라운드 작업은 계속 */
  void postLinkWork.catch(() => {});

  return json({
    ok: true,
    session: result.session,
    logs: [],
    sigImport,
  });
}

/** DELETE — 허브 로그아웃(세션·로그 삭제, toona 측 설정은 유지) */
export async function DELETE(req: NextRequest) {
  const auth = resolveWriteUserId(req);
  if (!auth.ok) return writeUserIdErrorResponse(auth);
  await clearToonaHubSession(auth.userId);
  await clearToonaHubDonationLogs(auth.userId);
  return json({ ok: true });
}
