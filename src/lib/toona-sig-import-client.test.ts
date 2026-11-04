import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  triggerAndPollSigImport,
  formatSigImportResultMessage,
  type SigImportSummary,
} from "./toona-sig-import-client";

describe("toona-sig-import-client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("formatSigImportResultMessage correctly displays added, updated and total counts", () => {
    const summary: SigImportSummary = {
      at: Date.now(),
      status: "completed",
      fetchedCount: 25,
      addedCount: 5,
      updatedCount: 10,
      totalCount: 30,
    };
    const msg = formatSigImportResultMessage(summary);
    expect(msg).toContain("총 25개 확인");
    expect(msg).toContain("신규 5개 추가");
    expect(msg).toContain("기존 10개 갱신");
    expect(msg).toContain("현재 총 30개 등록");
  });

  it("formatSigImportResultMessage displays up-to-date message when added=0, updated=0", () => {
    const summary: SigImportSummary = {
      at: Date.now(),
      status: "completed",
      fetchedCount: 15,
      addedCount: 0,
      updatedCount: 0,
      totalCount: 15,
    };
    const msg = formatSigImportResultMessage(summary);
    expect(msg).toContain("총 15개 확인");
    expect(msg).toContain("모두 최신 상태");
    expect(msg).toContain("현재 총 15개 등록");
  });

  it("triggerAndPollSigImport handles synchronous completion", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        count: 12,
        added: 2,
        updated: 3,
        totalCount: 20,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await triggerAndPollSigImport();
    expect(res.ok).toBe(true);
    expect(res.summary?.fetchedCount).toBe(12);
    expect(res.summary?.addedCount).toBe(2);
    expect(res.summary?.updatedCount).toBe(3);
    expect(res.summary?.totalCount).toBe(20);
  });

  it("triggerAndPollSigImport handles deferred background completion via polling", async () => {
    let pollCount = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: string, opts?: RequestInit) => {
      if (opts?.method === "POST") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, deferred: true }),
        };
      }
      pollCount++;
      if (pollCount === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            session: {
              lastSigImport: {
                at: Date.now(),
                status: "running",
                fetchedCount: 0,
                addedCount: 0,
                updatedCount: 0,
                totalCount: 0,
              },
            },
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          currentSigCount: 18,
          session: {
            lastSigImport: {
              at: Date.now(),
              status: "completed",
              fetchedCount: 10,
              addedCount: 4,
              updatedCount: 2,
              totalCount: 18,
            },
          },
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const progress: string[] = [];
    const res = await triggerAndPollSigImport((stage) => progress.push(stage));
    expect(res.ok).toBe(true);
    expect(res.summary?.status).toBe("completed");
    expect(res.summary?.fetchedCount).toBe(10);
    expect(res.summary?.addedCount).toBe(4);
    expect(res.summary?.updatedCount).toBe(2);
    expect(res.summary?.totalCount).toBe(18);
    expect(progress.length).toBeGreaterThan(0);
  });
});
