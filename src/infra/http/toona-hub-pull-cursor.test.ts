import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const hub = vi.hoisted(() => ({
  cursorWrites: [] as string[],
  commitIds: new Set<string>(),
  /** 다른 drain 이 대기열에서 꺼내 저장 중인 줄(대기열엔 없고 확정도 안 됨) */
  inFlightIds: new Set<string>(),
}));

vi.mock("@/lib/toona-hub-session", () => ({
  clearToonaHubDonationLogs: vi.fn(async () => {}),
  isToonaHubUserLoginRequired: () => false,
  publicToonaHubSession: (s: unknown) => s,
  readToonaHubDonationLogs: vi.fn(async () => []),
  readToonaHubPullCursor: vi.fn(async () => ({ fromMs: 0, after: "c000" })),
  readToonaHubSession: vi.fn(async () => ({
    userId: "din",
    baseUrl: "http://hub.local",
    email: "",
    token: "t",
    streamKey: "sk",
    linkedAt: 0,
  })),
  resolveToonaHubBearer: () => "t",
  TOONA_HUB_S2S_TOKEN: "",
  toonaHubAuthHeaders: () => ({}),
  writeToonaHubPullCursor: vi.fn(async (_uid: string, c: { after: string }) => {
    hub.cursorWrites.push(c.after);
  }),
  writeToonaHubSession: vi.fn(async () => {}),
}));

vi.mock("@/lib/din-ingest-batch-queue", async () => {
  const pending = await import("@/lib/din-ingest-pending");
  return {
    offerDinExcelIngest: (uid: string, event: never) => pending.offerPendingIngest(uid, uid, event),
    /** 정산표 저장이 일부만 끝난 상황: commitIds 에 있는 줄만 확정하고 나머지는 처리 중으로 남긴다 */
    drainDinIngestQueue: vi.fn(async (uid: string) => {
      const store = pending.getDinIngestStore();
      const q = store.byUser.get(uid) || [];
      const done = q.filter((r) => hub.commitIds.has(String(r.event.externalId)));
      const taken = q.filter((r) => hub.inFlightIds.has(String(r.event.externalId)));
      store.byUser.set(
        uid,
        q.filter((r) => !done.includes(r) && !taken.includes(r))
      );
      pending.forgetQueuedIds(uid, done);
    }),
  };
});

import { fetchToonaDonationsSinceLink } from "@/infra/http/toona-hub.client";
import { resetDinIngestBatchQueueForTests } from "@/lib/din-ingest-pending";

const realFetch = globalThis.fetch;
const ROWS = ["c001", "c002", "c003"].map((id, i) => ({
  id,
  amount: 10_000 + i,
  nickname: `후원자${i}`,
  channel: "account",
  createdAt: "2026-10-14 21:20:00",
}));

describe("허브 60초 수집 커서 — 확정된 후원까지만 앞으로 옮긴다", () => {
  beforeEach(() => {
    hub.cursorWrites.length = 0;
    hub.commitIds.clear();
    hub.inFlightIds.clear();
    resetDinIngestBatchQueueForTests();
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ donations: ROWS }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;
  });
  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  it("두 번째 후원이 아직 처리 중이면 커서는 첫 번째 후원에서 멈춘다 (재시작해도 다시 읽음)", async () => {
    hub.commitIds.add("c001");
    const r = await fetchToonaDonationsSinceLink("din", { ignoreMinInterval: true });
    expect(r.ok).toBe(true);
    expect(hub.cursorWrites.at(-1)).toBe("c001");
  });

  it("대기열엔 없지만 저장 중인 후원이 있으면 그 앞에서 멈춘다", async () => {
    hub.commitIds.add("c001");
    hub.inFlightIds.add("c002");
    hub.inFlightIds.add("c003");
    const r = await fetchToonaDonationsSinceLink("din", { ignoreMinInterval: true });
    expect(r.ok).toBe(true);
    expect(hub.cursorWrites.at(-1)).toBe("c001");
  });

  it("아무것도 확정되지 않았으면 커서를 옮기지 않는다", async () => {
    const r = await fetchToonaDonationsSinceLink("din", { ignoreMinInterval: true });
    expect(r.ok).toBe(true);
    expect(hub.cursorWrites.at(-1)).toBe("c000");
  });

  it("모두 확정되면 마지막 후원까지 옮긴다", async () => {
    for (const row of ROWS) hub.commitIds.add(row.id);
    const r = await fetchToonaDonationsSinceLink("din", { ignoreMinInterval: true });
    expect(r.ok).toBe(true);
    expect(hub.cursorWrites.at(-1)).toBe("c003");
  });
});
