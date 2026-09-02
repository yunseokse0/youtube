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

export type PersistDonationApiOptions = {
  /**
   * false: 서버가 state 본문을 응답에 넣지 않음 — 삭제 등 이미 로컬 정본일 때
   * JSON 파싱·전송 비용을 줄인다.
   */
  returnState?: boolean;
};

/**
 * 삭제·나누기·재배치 — 투네 apply 와 동일 서버 파이프라인(`/api/donations/persist`).
 */
export async function persistDonationStateViaApi(
  userId: string | undefined,
  state: AppState,
  mode: DonorsPersistMode = "replace",
  opts?: PersistDonationApiOptions
): Promise<PersistDonationApiResult> {
  const q = new URLSearchParams();
  if (userId) {
    q.set("user", userId);
    q.set("u", userId);
  }
  const returnState = opts?.returnState !== false;
  try {
    const res = await fetch(`/api/donations/persist?${q.toString()}`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state, mode, returnState }),
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
    if (!res.ok || !data?.ok) {
      return {
        ok: false,
        error: String(data?.error || `http_${res.status}`),
        status: res.status,
      };
    }
    const updatedAt = Number(data.updatedAt || data.state?.updatedAt || state.updatedAt || 0);
    const donorRankingsUpdatedAt =
      typeof data.donorRankingsUpdatedAt === "number"
        ? data.donorRankingsUpdatedAt
        : Number(data.state?.donorRankingsUpdatedAt || state.donorRankingsUpdatedAt || 0);
    const nextState: AppState = data.state
      ? data.state
      : {
          ...state,
          updatedAt: Math.max(Number(state.updatedAt || 0), updatedAt),
          donorRankingsUpdatedAt: Math.max(
            Number(state.donorRankingsUpdatedAt || 0),
            donorRankingsUpdatedAt
          ),
        };
    return {
      ok: true,
      state: nextState,
      updatedAt,
      donorRankingsUpdatedAt,
    };
  } catch {
    return { ok: false, error: "network" };
  }
}
