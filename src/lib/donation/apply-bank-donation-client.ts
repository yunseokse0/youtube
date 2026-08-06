import type { AppState, DonorTarget } from "@/types";

export type BankDonationApplyItem = {
  donorName: string;
  amount: number;
  memberId: string;
  target?: DonorTarget;
  message?: string;
  id?: string;
};

export type BankDonationApplyResult =
  | {
      ok: true;
      state: AppState;
      updatedAt: number;
      donorRankingsUpdatedAt?: number;
      appliedCount: number;
    }
  | { ok: false; error: string; status?: number };

/**
 * 수동 계좌·일괄 합산 — 투네와 동일 서버 파이프라인(`/api/donations/apply`).
 */
export async function applyBankDonationsViaApi(
  userId: string | undefined,
  items: BankDonationApplyItem[],
  opts?: { target?: DonorTarget }
): Promise<BankDonationApplyResult> {
  if (!items.length) return { ok: false, error: "no_valid_items" };
  const q = new URLSearchParams();
  if (userId) {
    q.set("user", userId);
    q.set("u", userId);
  }
  const credentials = "include" as const;
  try {
    const res = await fetch(`/api/donations/apply?${q.toString()}`, {
      method: "POST",
      credentials,
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target: opts?.target || "account",
        items: items.map((it) => ({
          donorName: it.donorName,
          amount: it.amount,
          memberId: it.memberId,
          target: it.target || opts?.target || "account",
          ...(it.message ? { message: it.message } : {}),
          ...(it.id ? { id: it.id } : {}),
        })),
      }),
    });
    const data = (await res.json().catch(() => null)) as
      | {
          ok?: boolean;
          error?: string;
          state?: AppState;
          updatedAt?: number;
          donorRankingsUpdatedAt?: number;
          applied?: unknown[];
        }
      | null;
    if (!res.ok || !data?.ok || !data.state) {
      return {
        ok: false,
        error: String(data?.error || `http_${res.status}`),
        status: res.status,
      };
    }
    return {
      ok: true,
      state: data.state,
      updatedAt: Number(data.updatedAt || data.state.updatedAt || 0),
      donorRankingsUpdatedAt:
        typeof data.donorRankingsUpdatedAt === "number"
          ? data.donorRankingsUpdatedAt
          : Number(data.state.donorRankingsUpdatedAt || 0),
      appliedCount: Array.isArray(data.applied) ? data.applied.length : items.length,
    };
  } catch {
    return { ok: false, error: "network" };
  }
}
