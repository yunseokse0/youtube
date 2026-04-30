export const runtime = "edge";
export const revalidate = 0;

import { upstashGetJson, upstashSetJsonWithSetPath } from "../_shared/upstash";

const ACCOUNTS_KEY = "excel-broadcast-accounts-v1";

export type Account = {
  id: string;
  name: string;
  companyName: string;
  password: string;
  startDate: number | null;
  endDate: number | null;
  createdAt: number;
};

function getAdminKey(req: Request): string | null {
  const url = new URL(req.url);
  return url.searchParams.get("key") || req.headers.get("x-admin-key");
}

function checkAdminKey(key: string | null): boolean {
  const expected = process.env.ADMIN_ACCOUNTS_KEY || "";
  if (!expected) return false;
  return key === expected;
}

async function upstashGet(key: string) {
  return upstashGetJson(key);
}

async function upstashSet(key: string, value: unknown) {
  return upstashSetJsonWithSetPath(key, value);
}

function toId(str: string): string {
  return str
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_-]/g, "");
}

export async function GET(req: Request) {
  const key = getAdminKey(req);
  if (!checkAdminKey(key)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }
  try {
    const accounts = (await upstashGet(ACCOUNTS_KEY)) as Account[] | null;
    const list = Array.isArray(accounts)
      ? accounts.map(({ password: _, ...a }) => a)
      : [];
    return new Response(JSON.stringify(list), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch {
    return new Response(JSON.stringify([]), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  }
}

export async function POST(req: Request) {
  const adminKey = getAdminKey(req);
  if (!checkAdminKey(adminKey)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
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
    const accounts = (await upstashGet(ACCOUNTS_KEY)) as Account[] | null;
    const list: Account[] = Array.isArray(accounts) ? accounts : [];
    let id = baseId;
    let suffix = 0;
    while (list.some((a) => a.id === id)) {
      suffix++;
      id = `${baseId}_${suffix}`;
    }
    const unlimited = body.unlimited === true;
    const startDate = unlimited ? null : (body.startDate ? new Date(body.startDate).getTime() : null);
    const endDate = unlimited ? null : (body.endDate ? new Date(body.endDate).getTime() : null);
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
    const ok = await upstashSet(ACCOUNTS_KEY, list);
    if (!ok) {
      return new Response(JSON.stringify({ error: "저장 실패" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ ok: true, account }), {
      headers: { "Content-Type": "application/json" },
      status: 201,
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "처리 중 오류" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
