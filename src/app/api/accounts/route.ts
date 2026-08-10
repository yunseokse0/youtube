export const runtime = "nodejs";
export const revalidate = 0;

import { defaultState } from "@/lib/state";
import {
  isAccountsRedisConfigured,
  loadAccounts,
  saveAccounts,
  type StoredAccount,
} from "@/lib/accounts-storage";
import { writeToonationListenerConfig } from "@/lib/donation/toonation/listener-config-store";
import { upstashSetAppStateJson } from "../_shared/upstash-app-state";

const STATE_KEY_BASE = "excel-broadcast-state-v1";

export type Account = StoredAccount;

function getAdminKey(req: Request): string | null {
  const url = new URL(req.url);
  return url.searchParams.get("key") || req.headers.get("x-admin-key");
}

function checkAdminKey(key: string | null): { ok: boolean; status: 401 | 503; error: string } {
  const expected = process.env.ADMIN_ACCOUNTS_KEY || "";
  if (!expected) {
    return {
      ok: false,
      status: 503,
      error: "ADMIN_ACCOUNTS_KEY 환경변수가 설정되지 않았습니다.",
    };
  }
  if (key !== expected) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  return { ok: true, status: 401, error: "" };
}

function toId(str: string): string {
  return str
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_-]/g, "");
}

async function initAccountAppState(userId: string): Promise<void> {
  if (!isAccountsRedisConfigured()) return;
  const key = `${STATE_KEY_BASE}:${userId}`;
  const seed = { ...defaultState(), updatedAt: Date.now() };
  await upstashSetAppStateJson(key, seed);
  /** 신규 계정은 투네 연동키 비움(타 계정 키 상속 방지) */
  await writeToonationListenerConfig({
    userId,
    alertboxUrl: "",
    ownerName: "",
    enabled: false,
    updatedAt: Date.now(),
  });
}

export async function GET(req: Request) {
  const auth = checkAdminKey(getAdminKey(req));
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!isAccountsRedisConfigured()) {
    return new Response(
      JSON.stringify({
        error: "영속 저장소 미설정 — DATABASE_URL(MySQL) 또는 UPSTASH_REDIS_* 를 설정하세요.",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }
  try {
    const accounts = await loadAccounts();
    const list = accounts.map(({ password: _, ...a }) => a);
    return new Response(JSON.stringify(list), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[api/accounts] GET failed", detail);
    return new Response(JSON.stringify({ error: "계정 목록 조회 실패", detail }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function POST(req: Request) {
  const auth = checkAdminKey(getAdminKey(req));
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { "Content-Type": "application/json" },
    });
  }
  try {
    const body = (await req.json()) as {
      name?: string;
      companyName?: string;
      password?: string;
      startDate?: string | null;
      endDate?: string | null;
      unlimited?: boolean;
    };
    const name = (body.name || "").trim();
    const companyName = (body.companyName || "").trim();
    const password = (body.password || "").trim();
    if (!name || !companyName || !password) {
      return new Response(
        JSON.stringify({ error: "이름, 회사명, 비밀번호는 필수입니다." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    const baseId = toId(name) || toId(companyName) || "user";
    const list = await loadAccounts();
    let id = baseId;
    let suffix = 0;
    while (list.some((a) => a.id === id)) {
      suffix++;
      id = `${baseId}_${suffix}`;
    }
    const unlimited = body.unlimited === true;
    const startDate = unlimited ? null : body.startDate ? new Date(body.startDate).getTime() : null;
    const endDate = unlimited ? null : body.endDate ? new Date(body.endDate).getTime() : null;
    const account: Account = {
      id,
      name,
      companyName,
      password,
      startDate,
      endDate,
      createdAt: Date.now(),
    };
    list.push(account);
    const saved = await saveAccounts(list);
    if (!saved.ok) {
      return new Response(JSON.stringify({ error: saved.error || "저장 실패" }), {
        status: saved.error?.includes("미설정") ? 503 : 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    await initAccountAppState(id);
    const { password: _, ...publicAccount } = account;
    return new Response(JSON.stringify({ ok: true, account: publicAccount }), {
      headers: { "Content-Type": "application/json" },
      status: 201,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[api/accounts] POST failed", detail);
    return new Response(JSON.stringify({ error: "처리 중 오류", detail }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
