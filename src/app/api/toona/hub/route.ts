import { NextRequest } from "next/server";
import { resolveWriteUserId, writeUserIdErrorResponse } from "@/app/api/_shared/user-id";
import { getYoutubePublicBaseUrl } from "@/lib/toona-link";
import { loginAndLinkToonaHub } from "@/infra/http/toona-hub-login-link";
import {
  clearToonaHubDonationLogs,
  clearToonaHubSession,
  publicToonaHubSession,
  readToonaHubDonationLogs,
  readToonaHubSession,
} from "@/lib/toona-hub-session";
import {
  describeDonationIntakeMode,
  isDonationIntakeModeB,
} from "@/policies/donation-intake-mode";
import {
  TOONA_HUB_ROUTE_MAX_DURATION_SEC,
  toonaHubLoginSuccessBody,
} from "@/lib/toona-hub-login";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = TOONA_HUB_ROUTE_MAX_DURATION_SEC;

function isToonaHubDisabledForMode(): boolean {
  return !isDonationIntakeModeB();
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store, max-age=0" },
  });
}

function scopedStateUserIdOf(authUserId: string): string {
  const id = String(authUserId || "").trim();
  return id || "finalent";
}

async function importSigsAfterHubLogin(hubSessionUserId: string) {
  const [{ fetchToonaSignaturesViaHubSession }, { defaultState }, { loadAppStateForUserId }, { applyToonaSigItemsToInventory }, { saveAppStateForRoulette }, { publishSseEvent }] =
    await Promise.all([
      import("@/lib/toona-hub-client"),
      import("@/lib/state"),
      import("@/lib/app-state-server-load"),
      import("@/lib/toona-sig-import"),
      import("@/app/api/roulette/edge-state-store"),
      import("@/lib/sse-clients-hub"),
    ]);
  const stateUserId = scopedStateUserIdOf(hubSessionUserId);
  const fetched = await fetchToonaSignaturesViaHubSession(hubSessionUserId);
  if (!fetched.ok) return { ok: false as const, count: 0, error: fetched.error };
  const state = (await loadAppStateForUserId(stateUserId)) ?? defaultState();
  const { nextInventory, added, updated } = applyToonaSigItemsToInventory(
    state.sigInventory || [],
    fetched.items,
    "merge"
  );
  const next = { ...state, sigInventory: nextInventory, updatedAt: Date.now() };
  const saved = await saveAppStateForRoulette(stateUserId, next, { donorsMode: "add" });
  if (!saved.ok) {
    return {
      ok: false as const,
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
    ok: true as const,
    count: fetched.count,
    added,
    updated,
    items: fetched.items,
    saved: true,
  };
}

export async function GET(req: NextRequest) {
  const auth = resolveWriteUserId(req);
  if (!auth.ok) return writeUserIdErrorResponse(auth);

  if (isToonaHubDisabledForMode()) {
    const session = await readToonaHubSession(auth.userId).catch(() => null);
    const logs = await readToonaHubDonationLogs(auth.userId).catch(() => []);
    const scenario = isDonationIntakeModeB() ? "B" : "A";
    return json({
      ok: true,
      disabled: true,
      mode: describeDonationIntakeMode(),
      scenario,
      reason:
        "현재 " +
        describeDonationIntakeMode() +
        " 이므로 DIN 허브 API를 사용하지 않고 투네 직접 WS 경로만 활성화됩니다. DIN 허브를 사용하려면 TOONA_INTAKE_MODE=B 로 설정하세요.",
      session: publicToonaHubSession(session),
      logs,
      donationLogs: logs,
    });
  }

  const scenario = isDonationIntakeModeB() ? "B" : "A";
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  if (refresh) {
    try {
      const timeoutMs = 12_000;
      const abortRef = { aborted: false };
      const { pollToonaHubForAdmin } = await import("@/lib/toona-hub-client");
      const pollPromise = (async () => {
        const polled = await pollToonaHubForAdmin(auth.userId);
        if (abortRef.aborted) return null;
        return polled;
      })();
      const timeoutPromise = new Promise<null>((res) =>
        setTimeout(() => {
          abortRef.aborted = true;
          res(null);
        }, timeoutMs)
      );
      const result = await Promise.race([pollPromise, timeoutPromise]);
      if (result) {
        return json({ ok: true, scenario, session: result.session, logs: result.logs, donationLogs: result.logs });
      }
      const session = await readToonaHubSession(auth.userId);
      const logs = await readToonaHubDonationLogs(auth.userId);
      return json({ ok: true, scenario, session: publicToonaHubSession(session), logs, donationLogs: logs, slow: true });
    } catch (err) {
      const session = await readToonaHubSession(auth.userId).catch(() => null);
      const logs = await readToonaHubDonationLogs(auth.userId).catch(() => []);
      return json({
        ok: true,
        scenario,
        session: publicToonaHubSession(session),
        logs,
        donationLogs: logs,
        error: err instanceof Error ? String(err.message || err).slice(0, 120) : "poll_failed",
      });
    }
  }

  const session = await readToonaHubSession(auth.userId);
  const logs = await readToonaHubDonationLogs(auth.userId);
  return json({ ok: true, scenario, session: publicToonaHubSession(session), logs, donationLogs: logs });
}

export async function POST(req: NextRequest) {
  const auth = resolveWriteUserId(req);
  if (!auth.ok) return writeUserIdErrorResponse(auth);

  if (isToonaHubDisabledForMode()) {
    const session = await readToonaHubSession(auth.userId).catch(() => null);
    const scenario = isDonationIntakeModeB() ? "B" : "A";
    return json(
      {
        ok: false,
        disabled: true,
        mode: describeDonationIntakeMode(),
        scenario,
        reason:
          "현재 " +
          describeDonationIntakeMode() +
          " 이므로 DIN 허브 연동·폴링 기능을 사용하지 않고 투네 직접 WS 경로만 활성화됩니다. DIN 허브를 사용하려면 TOONA_INTAKE_MODE=B 로 설정하세요.",
        session: publicToonaHubSession(session),
      },
      503
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    baseUrl?: string;
    action?: string;
    contributionFormula?: unknown;
  };

  if (body.action === "sync-donations") {
    const force = req.nextUrl.searchParams.get("force") === "1";
    const { fetchToonaDonationsSinceLink } = await import("@/lib/toona-hub-client");
    const result = await fetchToonaDonationsSinceLink(auth.userId, { ignoreMinInterval: force });
    if (!result.ok) return json({ ok: false, error: result.error }, 502);
    const logs = await readToonaHubDonationLogs(auth.userId);
    const session = await readToonaHubSession(auth.userId);
    const fetched = typeof result.imported === "number" ? result.imported : 0;
    const resultAny = result as unknown as { duplicates?: number; skipped?: number };
    const duplicatesNum = typeof resultAny.duplicates === "number"
      ? resultAny.duplicates
      : typeof fetched === "number" && typeof result.applied === "number"
        ? Math.max(0, fetched - result.applied)
        : 0;
    const skippedNum = typeof resultAny.skipped === "number" ? resultAny.skipped : 0;
    return json({
      ok: true,
      scenario: isDonationIntakeModeB() ? "B" : "A",
      fetched,
      imported: result.imported,
      applied: result.applied,
      duplicates: duplicatesNum,
      skipped: skippedNum,
      session: publicToonaHubSession(session),
      logs,
      donationLogs: logs,
    });
  }

  if (body.action === "sync-contribution-formula") {
    const [{ normalizeContributionFormula }, { syncContributionFormulaToToonaHub }] = await Promise.all([
      import("@/lib/contribution-formula"),
      import("@/lib/toona-hub-client"),
    ]);
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
    youtubeUserId: scopedStateUserIdOf(auth.userId),
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

  void (async () => {
    const [
      { loadAppStateForUserId },
      { normalizeContributionFormula },
      { persistContributionFormulaForUser },
      { fetchToonaHubContributionFormula, syncContributionFormulaToToonaHub },
    ] = await Promise.all([
      import("@/lib/app-state-server-load"),
      import("@/lib/contribution-formula"),
      import("@/lib/contribution-formula-persist"),
      import("@/lib/toona-hub-client"),
    ]);
    const stateUserId = scopedStateUserIdOf(auth.userId);
    const state = await loadAppStateForUserId(stateUserId);
    let formula = normalizeContributionFormula(
      body.contributionFormula ?? state?.contributionFormula
    );
    if (body.contributionFormula) {
      await persistContributionFormulaForUser(stateUserId, formula);
    } else {
      const fromToona = await fetchToonaHubContributionFormula(auth.userId);
      if (fromToona) {
        formula = fromToona;
        await persistContributionFormulaForUser(stateUserId, fromToona);
      }
    }
    await syncContributionFormulaToToonaHub(auth.userId, formula);
    await importSigsAfterHubLogin(auth.userId);
  })().catch(() => {});

  return json(toonaHubLoginSuccessBody(result.session));
}

export async function DELETE(req: NextRequest) {
  const auth = resolveWriteUserId(req);
  if (!auth.ok) return writeUserIdErrorResponse(auth);
  await clearToonaHubSession(auth.userId);
  await clearToonaHubDonationLogs(auth.userId);
  return json({ ok: true });
}
