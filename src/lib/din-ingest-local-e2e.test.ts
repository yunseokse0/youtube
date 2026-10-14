import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/** 라이브 MySQL·Redis·허브에 절대 닿지 않게: 저장소 env 제거 + 외부 fetch 차단 */
const savedEnv = vi.hoisted(() => {
  const keys = [
    "DATABASE_URL",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    "KV_REST_API_URL",
    "KV_REST_API_TOKEN",
    "TOONA_INGEST_SECRET",
  ];
  const saved: Record<string, string | undefined> = {};
  for (const key of keys) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  process.env.TOONA_INGEST_SECRET = "local-e2e-secret";
  return saved;
});

import { defaultState, normalizeDonorsArray } from "@/lib/state";
import type { AppState, Member } from "@/types";
import { POST as ingestPost } from "@/app/api/donations/ingest/route";
import { POST as persistPost } from "@/app/api/donations/persist/route";
import { saveAppStateForRoulette } from "@/app/api/roulette/edge-state-store";
import { loadAppStateForUserId } from "@/lib/app-state-server-load";
import { readDonationQueue } from "@/app/api/donations/_shared/queue-store";
import { isRedisConfigured } from "@/app/api/_shared/upstash";
import { offerDinExcelIngest } from "@/lib/din-ingest-batch-queue";
import { getDinIngestStore } from "@/lib/din-ingest-pending";

const UID = "din";
const realFetch = globalThis.fetch;

function member(id: string, name: string): Member {
  return { id, name, account: 0, toon: 0, contribution: 0, operating: false } as Member;
}

const MEMBERS = [member("m1", "소야"), member("m2", "자키"), member("m3", "예나")];
const NAMES = ["준이", "민수", "하늘", "별빛", "준이"];
const AMOUNTS = [11_900, 1_000, 3_000, 11_900, 50_000];

let seq = 0;
function hubBody(extra?: Record<string, unknown>) {
  seq += 1;
  const cuid = `cme2e${String(seq).padStart(6, "0")}`;
  const m = MEMBERS[seq % MEMBERS.length]!;
  return {
    cuid,
    body: {
      id: `bank:sms:${cuid}`,
      externalId: cuid,
      provider: "bank",
      target: "account",
      donorName: NAMES[seq % NAMES.length],
      amount: AMOUNTS[seq % AMOUNTS.length],
      at: new Date().toISOString(),
      memberId: m.id,
      manualAssignMemberId: m.id,
      ...extra,
    },
  };
}

function ingest(body: Record<string, unknown>): Promise<Response> {
  return ingestPost(
    new Request(`http://localhost/api/donations/ingest?u=${UID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer local-e2e-secret" },
      body: JSON.stringify(body),
    })
  );
}

function persistReplace(state: AppState, removedDonorIds?: string[]): Promise<Response> {
  return persistPost(
    new Request(`http://localhost/api/donations/persist?u=${UID}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `sb_user=${encodeURIComponent(JSON.stringify({ id: UID }))}`,
      },
      body: JSON.stringify({
        state,
        mode: "replace",
        returnState: false,
        ...(removedDonorIds ? { removedDonorIds } : {}),
      }),
    })
  );
}

async function waitDrained(): Promise<void> {
  const store = getDinIngestStore();
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const rows = store.byUser.get(UID) || [];
    const ids = store.idsByUser.get(UID);
    if (rows.length === 0 && !store.draining.has(UID) && (!ids || ids.size === 0)) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("ingest queue did not drain");
}

async function ledgerCuids(): Promise<Map<string, number>> {
  const state = await loadAppStateForUserId(UID);
  const out = new Map<string, number>();
  for (const d of normalizeDonorsArray(state?.donors)) {
    if (d.donationExcluded) continue;
    const key = String(d.externalId || d.id || "").replace(/^bank:(sms|din):/, "");
    out.set(key, (out.get(key) || 0) + 1);
  }
  return out;
}

async function adminQueueCuids(): Promise<Set<string>> {
  const list = await readDonationQueue(UID);
  return new Set(list.map((e) => String(e.externalId || "")));
}

describe("DIN 허브 수집 로컬 종단 테스트 (메모리 저장소)", () => {
  beforeAll(async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      throw new Error(`network blocked in local e2e: ${String(input)}`);
    }) as typeof fetch;
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(isRedisConfigured()).toBe(false);
    expect(process.env.DATABASE_URL).toBeUndefined();

    const seeded = await saveAppStateForRoulette(
      UID,
      { ...defaultState(), members: MEMBERS.map((m) => ({ ...m })), donors: [], updatedAt: Date.now() },
      { allowEmptyRosterWipe: true }
    );
    expect(seeded.ok).toBe(true);
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("동시에 몰린 후원 300건 + 매칭 안 되는 5건 + 허브 보조 수집 중복이 하나도 빠지거나 두 번 들어가지 않는다", async () => {
    const matched = Array.from({ length: 300 }, () => hubBody());
    const unmatched = Array.from({ length: 5 }, () =>
      hubBody({ memberId: "", manualAssignMemberId: "없는멤버", playerName: "없는멤버" })
    );
    const all = [...matched, ...unmatched];

    const responses = await Promise.all(
      all.map((row, i) => {
        if (i % 6 === 0) {
          /** 60초 보조 수집이 같은 후원을 bank:din:<cuid> 로 다시 넣는 상황 */
          offerDinExcelIngest(UID, {
            ...(row.body as Record<string, unknown>),
            id: `bank:din:${row.cuid}`,
            status: "queued",
          } as never);
        }
        return ingest(row.body);
      })
    );
    for (const res of responses) expect(res.status).toBe(200);

    await waitDrained();

    const ledger = await ledgerCuids();
    const missing = matched.filter((r) => !ledger.has(r.cuid)).map((r) => r.cuid);
    const doubled = [...ledger.entries()].filter(([, n]) => n > 1).map(([k]) => k);
    expect(missing).toEqual([]);
    expect(doubled).toEqual([]);

    const queue = await adminQueueCuids();
    for (const r of unmatched) {
      expect(ledger.has(r.cuid) || queue.has(r.cuid)).toBe(true);
    }
  }, 60_000);

  it("멤버를 못 찾는 계좌 후원은 자동 지정 멤버로 정산표에 바로 들어간다 (매칭 대기열로 안 감)", async () => {
    const current = (await loadAppStateForUserId(UID))!;
    const saved = await saveAppStateForRoulette(UID, {
      ...current,
      donationAutoAssignMemberId: "m2",
      updatedAt: Date.now(),
    });
    expect(saved.ok).toBe(true);

    /** 허브 계좌 후원처럼 memberId·manualAssignMemberId 없이, 멤버 이름이 없는 입금자·메모 */
    const rows = Array.from({ length: 20 }, (_, i) =>
      hubBody({ memberId: "", manualAssignMemberId: "", donorName: `가나다${i}`, message: "감사합니다" })
    );
    await Promise.all(rows.map((r) => ingest(r.body)));
    await waitDrained();

    const state = (await loadAppStateForUserId(UID))!;
    const queue = await adminQueueCuids();
    for (const r of rows) {
      const donor = normalizeDonorsArray(state.donors).find((d) => d.externalId === r.cuid);
      expect(donor?.memberId).toBe("m2");
      expect(queue.has(r.cuid)).toBe(false);
    }
  }, 60_000);

  it("입금자명이 `후원자_멤버` 로 오면 자동 지정 멤버가 아니라 그 멤버로 들어간다", async () => {
    const row = hubBody({ memberId: "", manualAssignMemberId: "", donorName: "준이_예나", message: "" });
    await ingest(row.body);
    await waitDrained();
    const state = (await loadAppStateForUserId(UID))!;
    const donor = normalizeDonorsArray(state.donors).find((d) => d.externalId === row.cuid);
    expect(donor?.memberId).toBe("m3");
  }, 60_000);

  it("예전 화면 상태로 1건을 지워도 그 사이 들어온 후원은 남는다", async () => {
    const staleTab = (await loadAppStateForUserId(UID))!;
    const target = normalizeDonorsArray(staleTab.donors).find((d) => !d.donationExcluded)!;

    const fresh = Array.from({ length: 30 }, () => hubBody());
    await Promise.all(fresh.map((r) => ingest(r.body)));
    await waitDrained();

    const nextDonors = normalizeDonorsArray(staleTab.donors).filter((d) => d.id !== target.id);
    const res = await persistReplace({ ...staleTab, donors: nextDonors, updatedAt: Date.now() }, [target.id]);
    expect(res.status).toBe(200);

    const ledger = await ledgerCuids();
    const targetKey = String(target.externalId || target.id).replace(/^bank:(sms|din):/, "");
    expect(ledger.has(targetKey)).toBe(false);
    expect(fresh.filter((r) => !ledger.has(r.cuid)).map((r) => r.cuid)).toEqual([]);
  }, 60_000);

  it("수집과 삭제 저장이 동시에 섞여도 지운 것만 빠지고 새 후원은 전부 남는다", async () => {
    const staleTab = (await loadAppStateForUserId(UID))!;
    const victims = normalizeDonorsArray(staleTab.donors)
      .filter((d) => !d.donationExcluded)
      .slice(0, 3);
    const before = await ledgerCuids();

    const fresh = Array.from({ length: 60 }, () => hubBody());
    let removed: string[] = [];
    /** 한 탭의 저장은 순서대로 나간다 — 수집과만 겹치게 */
    let tabChain: Promise<unknown> = Promise.resolve();
    const jobs: Promise<Response>[] = [];
    fresh.forEach((r, i) => {
      jobs.push(ingest(r.body));
      if (i % 20 === 10) {
        const victim = victims[Math.floor(i / 20)]!;
        removed = [...removed, victim.id];
        const donors = normalizeDonorsArray(staleTab.donors).filter((d) => !removed.includes(d.id));
        const ids = [...removed];
        const job = tabChain.then(() => persistReplace({ ...staleTab, donors, updatedAt: Date.now() }, ids));
        tabChain = job;
        jobs.push(job);
      }
    });
    const results = await Promise.all(jobs);
    for (const res of results) expect(res.status).toBe(200);
    await waitDrained();

    const ledger = await ledgerCuids();
    const victimKeys = new Set(
      victims.map((d) => String(d.externalId || d.id).replace(/^bank:(sms|din):/, ""))
    );
    expect([...victimKeys].filter((key) => ledger.has(key))).toEqual([]);
    expect(fresh.filter((r) => !ledger.has(r.cuid)).map((r) => r.cuid)).toEqual([]);
    const survivorsMissing = [...before.keys()].filter((k) => !victimKeys.has(k) && !ledger.has(k));
    expect(survivorsMissing).toEqual([]);
  }, 60_000);
});
