export const runtime = "edge";
export const revalidate = 0;

import type { Account } from "../route";
import { upstashGetJson, upstashSetJsonWithSetPath } from "../../_shared/upstash";

const ACCOUNTS_KEY = "excel-broadcast-accounts-v1";

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

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminKey = getAdminKey(req);
  if (!checkAdminKey(adminKey)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }
  const { id } = await params;
  try {
    const body = (await req.json()) as {
      startDate?: string | null;
      endDate?: string | null;
      unlimited?: boolean;
    };
    const accounts = (await upstashGet(ACCOUNTS_KEY)) as Account[] | null;
    const list: Account[] = Array.isArray(accounts) ? accounts : [];
    const idx = list.findIndex((a) => a.id === id);
    if (idx < 0) {
      return new Response(JSON.stringify({ error: "계정을 찾을 수 없습니다." }), { status: 404, headers: { "Content-Type": "application/json" } });
    }
    const unlimited = body.unlimited === true;
    if (unlimited) {
      list[idx] = { ...list[idx], startDate: null, endDate: null };
    } else {
      if (body.startDate !== undefined) {
        list[idx].startDate = body.startDate ? new Date(body.startDate).getTime() : null;
      }
      if (body.endDate !== undefined) {
        list[idx].endDate = body.endDate ? new Date(body.endDate).getTime() : null;
      }
    }
    const ok = await upstashSet(ACCOUNTS_KEY, list);
    if (!ok) {
      return new Response(JSON.stringify({ error: "저장 실패" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ ok: true, account: list[idx] }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch {
    return new Response(JSON.stringify({ error: "처리 중 오류" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminKey = getAdminKey(req);
  if (!checkAdminKey(adminKey)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }
  const { id } = await params;
  try {
    const accounts = (await upstashGet(ACCOUNTS_KEY)) as Account[] | null;
    const list: Account[] = Array.isArray(accounts) ? accounts : [];
    const filtered = list.filter((a) => a.id !== id);
    if (filtered.length === list.length) {
      return new Response(JSON.stringify({ error: "계정을 찾을 수 없습니다." }), { status: 404, headers: { "Content-Type": "application/json" } });
    }
    const ok = await upstashSet(ACCOUNTS_KEY, filtered);
    if (!ok) {
      return new Response(JSON.stringify({ error: "삭제 실패" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ ok: true, deleted: id }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch {
    return new Response(JSON.stringify({ error: "처리 중 오류" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
