import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * MySQL 이 자주 실패·지연되는 상황을 가짜 MySQL 로 재현한다(라이브 DB·허브에 닿지 않음).
 * 저장 3번 중 1번꼴로 실패해도 후원이 메모리 정산표와 MySQL 양쪽에 빠짐없이 남아야 한다.
 */
const fake = vi.hoisted(() => {
  const keys = [
    "DATABASE_URL",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    "KV_REST_API_URL",
    "KV_REST_API_TOKEN",
    "TOONA_INGEST_SECRET",
  ];
  const savedEnv: Record<string, string | undefined> = {};
  for (const key of keys) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.DATABASE_URL = "mysql://fake:fake@127.0.0.1:9/fake_local_e2e";
  process.env.TOONA_INGEST_SECRET = "local-flaky-secret";

  let rnd = 20261014;
  const random = () => {
    rnd = (rnd * 1103515245 + 12345) % 2147483648;
    return rnd / 2147483648;
  };
  const store = new Map<string, string>();
  const stats = { setFail: 0, setOk: 0, getFail: 0 };
  let lastError: string | null = null;
  const delay = () => new Promise((r) => setTimeout(r, Math.floor(random() * 15)));

  const backend = {
    async mysqlKvGetJson<T>(key: string): Promise<T | null> {
      await delay();
      if (random() < 0.33) {
        stats.getFail += 1;
        lastError = "fake mysql: get timeout";
        return null;
      }
      lastError = null;
      const raw = store.get(key);
      return raw == null ? null : (JSON.parse(raw) as T);
    },
    async mysqlKvSetJson(key: string, value: unknown): Promise<boolean> {
      await delay();
      if (random() < 0.33) {
        stats.setFail += 1;
        lastError = "fake mysql: set timeout";
        return false;
      }
      lastError = null;
      stats.setOk += 1;
      store.set(key, JSON.stringify(value));
      return true;
    },
    async mysqlKvSetNxEx(key: string): Promise<boolean | null> {
      if (store.has(key)) return false;
      store.set(key, "1");
      return true;
    },
    async mysqlKvDel(key: string): Promise<void> {
      store.delete(key);
    },
    getLastMysqlKvError: () => lastError,
  };
  return { savedEnv, store, stats, backend };
});

vi.mock("@/app/api/_shared/mysql-kv", () => fake.backend);

import { defaultState, normalizeDonorsArray } from "@/lib/state";
import type { AppState, Member } from "@/types";
import { POST as ingestPost } from "@/app/api/donations/ingest/route";
import { saveAppStateForRoulette } from "@/app/api/roulette/edge-state-store";
import {
  isMysqlOnlyPersistentKvConfigured,
  registerMysqlKvBackend,
} from "@/app/api/_shared/upstash";
import { getPendingAppStateWriteCount } from "@/app/api/_shared/upstash-app-state";
import { appStateStorageKey } from "@/lib/app-state-server-load";
import { getServerMemoryAppState } from "@/lib/server-memory-app-state";
import { getDinIngestStore } from "@/lib/din-ingest-pending";

const UID = "din";
const realFetch = globalThis.fetch;

function member(id: string, name: string): Member {
  return { id, name, account: 0, toon: 0, contribution: 0, operating: false } as Member;
}
const MEMBERS = [member("m1", "소야"), member("m2", "자키"), member("m3", "예나")];

let seq = 0;
function hubBody() {
  seq += 1;
  const cuid = `cmflaky${String(seq).padStart(5, "0")}`;
  const m = MEMBERS[seq % MEMBERS.length]!;
  return {
    cuid,
    body: {
      id: `bank:sms:${cuid}`,
      externalId: cuid,
      provider: "bank",
      target: seq % 2 ? "account" : "toon",
      donorName: `후원자${seq % 7}`,
      amount: [10_000, 11_900, 20_000, 51_000][seq % 4],
      at: new Date().toISOString(),
      memberId: m.id,
      manualAssignMemberId: m.id,
    },
  };
}

function ingest(body: Record<string, unknown>): Promise<Response> {
  return ingestPost(
    new Request(`http://localhost/api/donations/ingest?u=${UID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer local-flaky-secret" },
      body: JSON.stringify(body),
    })
  );
}

async function waitUntil(check: () => boolean, label: string, ms = 90_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function cuidCounts(state: AppState | null | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const d of normalizeDonorsArray(state?.donors)) {
    const key = String(d.externalId || d.id || "").replace(/^bank:(sms|din):/, "");
    out.set(key, (out.get(key) || 0) + 1);
  }
  return out;
}

describe("MySQL 이 자주 실패해도 후원이 빠지지 않는다 (가짜 MySQL)", () => {
  beforeAll(async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      throw new Error(`network blocked in local e2e: ${String(input)}`);
    }) as typeof fetch;
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    registerMysqlKvBackend(fake.backend);
    expect(isMysqlOnlyPersistentKvConfigured()).toBe(true);

    await saveAppStateForRoulette(
      UID,
      { ...defaultState(), members: MEMBERS.map((m) => ({ ...m })), donors: [], updatedAt: Date.now() },
      { allowEmptyRosterWipe: true }
    );
    expect(getServerMemoryAppState(UID)?.members?.length).toBe(3);
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
    for (const [key, value] of Object.entries(fake.savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("후원 200건이 동시에 몰리고 MySQL 저장·읽기가 1/3 실패해도 메모리와 MySQL 양쪽에 전부 한 번씩 남는다", async () => {
    const rows = Array.from({ length: 200 }, () => hubBody());
    const responses = await Promise.all(rows.map((r) => ingest(r.body)));
    for (const res of responses) expect(res.status).toBe(200);

    const store = getDinIngestStore();
    await waitUntil(
      () =>
        (store.byUser.get(UID) || []).length === 0 &&
        !store.draining.has(UID) &&
        (store.idsByUser.get(UID)?.size ?? 0) === 0,
      "ingest queue drain"
    );
    await waitUntil(() => getPendingAppStateWriteCount() === 0, "MySQL retry until saved");

    const mem = cuidCounts(getServerMemoryAppState(UID));
    expect(rows.filter((r) => !mem.has(r.cuid)).map((r) => r.cuid)).toEqual([]);
    expect([...mem.entries()].filter(([, n]) => n > 1)).toEqual([]);

    /** 재시작하면 메모리가 비고 MySQL 에 있는 것만 남는다 */
    const raw = fake.store.get(appStateStorageKey(UID));
    const onDisk = cuidCounts(raw ? (JSON.parse(raw) as AppState) : null);
    expect(rows.filter((r) => !onDisk.has(r.cuid)).map((r) => r.cuid)).toEqual([]);
    expect([...onDisk.entries()].filter(([, n]) => n > 1)).toEqual([]);

    expect(fake.stats.setFail).toBeGreaterThan(0);
  }, 120_000);
});
