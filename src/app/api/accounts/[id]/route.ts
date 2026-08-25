export const revalidate = 0;
export const runtime = "nodejs";

import { loadAccounts, saveAccounts } from "@/lib/accounts-storage";
import type { Account } from "../route";
import { registerMysqlKvBackend } from "../../_shared/upstash";

async function ensureMysqlKvBackend(): Promise<void> {
  const url = String(process.env.DATABASE_URL || "").trim();
  if (!url || !/^mysql:\/\//i.test(url)) return;
  try {
    const mysqlKv = await import("../../_shared/mysql-kv");
    registerMysqlKvBackend(mysqlKv);
  } catch (err) {
    console.error("[api/accounts/[id]] mysql-kv register failed", err);
  }
}

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

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = checkAdminKey(getAdminKey(req));
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { "Content-Type": "application/json" },
    });
  }
  const { id } = await params;
  try {
    await ensureMysqlKvBackend();
    const body = (await req.json()) as {
      startDate?: string | null;
      endDate?: string | null;
      unlimited?: boolean;
      password?: string | null;
      toonaEmail?: string | null;
    };
    const list = await loadAccounts();
    const idx = list.findIndex((a) => a.id === id);
    if (idx < 0) {
      return new Response(JSON.stringify({ error: "계정을 찾을 수 없습니다." }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
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
    if (typeof body.password === "string") {
      const nextPassword = body.password.trim();
      if (!nextPassword) {
        return new Response(JSON.stringify({ error: "비밀번호를 비울 수 없습니다." }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      list[idx] = { ...list[idx], password: nextPassword };
    }
    if (body.toonaEmail !== undefined) {
      const nextEmail = String(body.toonaEmail || "").trim();
      list[idx] = {
        ...list[idx],
        ...(nextEmail ? { toonaEmail: nextEmail } : {}),
      };
      if (!nextEmail) {
        const { toonaEmail: _, ...rest } = list[idx];
        list[idx] = rest as typeof list[number];
      }
    }
    const saved = await saveAccounts(list);
    if (!saved.ok) {
      return new Response(JSON.stringify({ error: saved.error || "저장 실패" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    const { password: _, ...publicAccount } = list[idx] as Account;
    return new Response(JSON.stringify({ ok: true, account: publicAccount }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch {
    return new Response(JSON.stringify({ error: "처리 중 오류" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = checkAdminKey(getAdminKey(req));
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { "Content-Type": "application/json" },
    });
  }
  const { id } = await params;
  try {
    const list = await loadAccounts();
    const filtered = list.filter((a) => a.id !== id);
    if (filtered.length === list.length) {
      return new Response(JSON.stringify({ error: "계정을 찾을 수 없습니다." }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    const saved = await saveAccounts(filtered);
    if (!saved.ok) {
      return new Response(JSON.stringify({ error: saved.error || "삭제 실패" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true, deleted: id }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch {
    return new Response(JSON.stringify({ error: "처리 중 오류" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
