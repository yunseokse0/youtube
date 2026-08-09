import type { AppState } from "@/types";
import type { DonorsPersistMode } from "@/app/api/roulette/edge-state-store";

export type PersistDonationApiResult =
  | {
      ok: true;
      state: AppState;
      updatedAt: number;
      donorRankingsUpdatedAt?: number;
    }
  | { ok: false; error: string; status?: number };

/**
 * 삭제·나누기·재배치 — 투네 apply 와 동일 서버 파이프라인(`/api/donations/persist`).
 */
export async function persistDonationStateViaApi(
  userId: string | undefined,
  state: AppState,
  mode: DonorsPersistMode = "replace"
): Promise<PersistDonationApiResult> {
  const q = new URLSearchParams();
  if (userId) {
    q.set("user", userId);
    q.set("u", userId);
  }
  try {
    const res = await fetch(`/api/donations/persist?${q.toString()}`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state, mode }),
    });
    const data = (await res.json().catch(() => null)) as
      | {
          ok?: boolean;
          error?: string;
          state?: AppState;
          updatedAt?: number;
          donorRankingsUpdatedAt?: number;
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
    };
  } catch {
    return { ok: false, error: "network" };
  }
}
