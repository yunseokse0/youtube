import { NextRequest } from "next/server";
import { resolveWriteUserId, writeUserIdErrorResponse } from "@/app/api/_shared/user-id";
import { fetchToonaSignaturesViaHubSession } from "@/lib/toona-hub-client";
import {
  fetchToonaDefaultAlertImageUrl,
  mapToonaSignaturesToSigItems,
  normalizeToonaApiBaseUrl,
  type ToonaSignatureRow,
} from "@/lib/toona-sig-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  baseUrl?: string;
  email?: string;
  password?: string;
  /** true면 허브 세션으로 조회 (비밀번호 불필요) */
  useHubSession?: boolean;
};

async function readJsonBody(req: NextRequest): Promise<Body> {
  try {
    return (await req.json()) as Body;
  } catch {
    return {};
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

/**
 * toona 시그 목록 → youtube SigItem[]
 * - useHubSession: 허브 로그인 세션 사용
 * - 아니면 email/password로 로그인 후 조회
 */
export async function POST(req: NextRequest) {
  const auth = resolveWriteUserId(req);
  if (!auth.ok) return writeUserIdErrorResponse(auth);

  const body = await readJsonBody(req);

  if (body.useHubSession) {
    const result = await fetchToonaSignaturesViaHubSession(auth.userId);
    if (!result.ok) {
      const status = result.error === "hub_not_linked" ? 409 : 502;
      return json({ ok: false, error: result.error }, status);
    }
    return json({
      ok: true,
      streamKey: result.streamKey,
      baseUrl: result.baseUrl,
      count: result.count,
      items: result.items,
      activePresetId: result.activePresetId,
      activePresetName: result.activePresetName,
      presets: result.presets,
      via: "hub_session",
    });
  }

  const baseUrl = normalizeToonaApiBaseUrl(String(body.baseUrl || ""));
  const email = String(body.email || "").trim();
  const password = String(body.password || "");

  if (!baseUrl) {
    return json({ ok: false, error: "invalid_base_url" }, 400);
  }
  if (!email || !password) {
    return json({ ok: false, error: "credentials_required" }, 400);
  }

  let loginRes: Response;
  try {
    loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "fetch_failed";
    return json({ ok: false, error: "toona_unreachable", message }, 502);
  }

  const loginJson = (await loginRes.json().catch(() => ({}))) as {
    token?: string;
    streamKey?: string | null;
    error?: string;
    streamer?: { defaultAlertImageUrl?: string | null } | null;
  };

  if (!loginRes.ok || !loginJson.token) {
    return json(
      {
        ok: false,
        error: "login_failed",
        message: loginJson.error || `HTTP ${loginRes.status}`,
      },
      loginRes.status === 401 ? 401 : 502
    );
  }

  const streamKey = String(loginJson.streamKey || "").trim();
  if (!streamKey) {
    return json({ ok: false, error: "no_stream_key", message: "스트리머가 연결된 계정이 아닙니다." }, 400);
  }

  let sigRes: Response;
  try {
    sigRes = await fetch(`${baseUrl}/api/signatures/${encodeURIComponent(streamKey)}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${loginJson.token}`,
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "fetch_failed";
    return json({ ok: false, error: "signatures_unreachable", message }, 502);
  }

  const sigJson = (await sigRes.json().catch(() => ({}))) as {
    signatures?: ToonaSignatureRow[];
    presets?: Array<{ id: string; name: string; count: number; isActive?: boolean; enabledSignatureIds?: string[] }>;
    activePresetId?: string | null;
    activePresetName?: string | null;
    activePresetEnabledSignatureIds?: string[] | null;
    error?: string;
  };

  if (!sigRes.ok) {
    return json(
      {
        ok: false,
        error: "signatures_failed",
        message: sigJson.error || `HTTP ${sigRes.status}`,
      },
      sigRes.status === 401 || sigRes.status === 403 ? sigRes.status : 502
    );
  }

  const fromLogin = String(loginJson.streamer?.defaultAlertImageUrl || "").trim();
  const defaultAlertImageUrl =
    fromLogin ||
    (await fetchToonaDefaultAlertImageUrl(baseUrl, streamKey, {
      Authorization: `Bearer ${loginJson.token}`,
    }));

  const currentPreset = (sigJson.presets || []).find(
    (p: any) => String(p.id) === String(sigJson.activePresetId || "") || p.isActive
  );

  const extractIdsFromPreset = (p: any): string[] | null => {
    if (!p) return null;
    if (Array.isArray(p.enabledSignatureIds) && p.enabledSignatureIds.length > 0) return p.enabledSignatureIds.map(String);
    if (Array.isArray(p.signatureIds) && p.signatureIds.length > 0) return p.signatureIds.map(String);
    if (Array.isArray(p.signature_ids) && p.signature_ids.length > 0) return p.signature_ids.map(String);
    if (Array.isArray(p.signatures) && p.signatures.length > 0) return p.signatures.map((s: any) => String(s?.id || s));
    return null;
  };

  const activeEnabledIds: string[] | null =
    (Array.isArray(sigJson.activePresetEnabledSignatureIds) && sigJson.activePresetEnabledSignatureIds.length > 0)
      ? sigJson.activePresetEnabledSignatureIds.map(String)
      : (Array.isArray((sigJson as any).activePresetSignatureIds) && (sigJson as any).activePresetSignatureIds.length > 0)
        ? (sigJson as any).activePresetSignatureIds.map(String)
        : extractIdsFromPreset(currentPreset);

  if (activeEnabledIds && activeEnabledIds.length > 0) {
    const activeSet = new Set(activeEnabledIds.map(String));
    for (const row of sigJson.signatures || []) {
      if (row.id) {
        row.enabled = activeSet.has(String(row.id));
      }
    }
  }

  const targetSignatures = (sigJson.signatures || []).filter((row) => {
    if (activeEnabledIds && activeEnabledIds.length > 0) {
      const activeSet = new Set(activeEnabledIds.map(String));
      return row.id ? activeSet.has(String(row.id)) : row.enabled !== false;
    }
    return row.enabled !== false;
  });

  const items = mapToonaSignaturesToSigItems(
    targetSignatures,
    baseUrl,
    defaultAlertImageUrl
  );

  return json({
    ok: true,
    streamKey,
    baseUrl,
    count: items.length,
    items,
    activePresetId: sigJson.activePresetId ?? null,
    activePresetName: sigJson.activePresetName ?? null,
    presets: Array.isArray(sigJson.presets) ? sigJson.presets : [],
    via: "login",
  });
}
