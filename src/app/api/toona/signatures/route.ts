import { NextRequest } from "next/server";
import { resolveWriteUserId, writeUserIdErrorResponse } from "@/app/api/_shared/user-id";
import {
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
 * toona 로그인 후 시그 목록을 youtube SigItem[] 로 매핑해 반환.
 * 비밀번호는 서버에서만 사용하며 저장하지 않음.
 */
export async function POST(req: NextRequest) {
  const auth = resolveWriteUserId(req);
  if (!auth.ok) return writeUserIdErrorResponse(auth);

  const body = await readJsonBody(req);
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

  const items = mapToonaSignaturesToSigItems(sigJson.signatures || [], baseUrl);

  return json({
    ok: true,
    streamKey,
    baseUrl,
    count: items.length,
    items,
  });
}
