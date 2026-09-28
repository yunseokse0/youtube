import { describe, expect, it } from "vitest";

/** deploy/ec2-donation-loadtest-summary.py 와 같은 판정. 누락 = 허브 id ∉ 정산표 전체 */
const STATE_ID_PREFIXES = ["toonation:din:", "bank:din:", "toonation:", "bank:sms:", "bank:"];

function stateMatchKeys(donors: Array<{ id?: string; externalId?: string }>) {
  const keys = new Set<string>();
  for (const d of donors) {
    for (const raw of [String(d.id || "").trim(), String(d.externalId || "").trim()]) {
      if (!raw) continue;
      keys.add(raw);
      for (const p of STATE_ID_PREFIXES) {
        if (raw.startsWith(p) && raw.length > p.length) keys.add(raw.slice(p.length));
      }
    }
  }
  return keys;
}

function summarize(args: {
  stateDonors: Array<{ id?: string; externalId?: string; amount?: number }>;
  hubLogs: Array<{ id?: string; amount?: number }>;
  queue: number;
  unmatch: number;
  stateBytes: number;
  parseOk: boolean;
}) {
  const stIds = new Set(args.stateDonors.map((x) => String(x.id || "").trim()).filter(Boolean));
  const stMatch = stateMatchKeys(args.stateDonors);
  const hIds = new Set(args.hubLogs.map((x) => String(x.id || "").trim()).filter(Boolean));
  const missing = [...hIds].filter((id) => !stMatch.has(id)).sort();
  const donorsOk = args.parseOk && Array.isArray(args.stateDonors);
  let verdict: string;
  if (!donorsOk || args.stateBytes <= 0) verdict = "STATE_FAIL";
  else if (missing.length > 0) verdict = "MISSING";
  else if (args.queue >= 20 || args.unmatch >= 10) verdict = "BACKLOG";
  else verdict = "OK";
  return { verdict, missing_n: missing.length, state_n: stIds.size, hub_n: hIds.size };
}

describe("부하테스트 모니터 판정", () => {
  it("허브 건수가 정산표보다 작아도 누락이 아니다", () => {
    const out = summarize({
      stateDonors: [
        { id: "a", amount: 1000 },
        { id: "b", amount: 2000 },
        { id: "c", amount: 3000 },
      ],
      hubLogs: [{ id: "c", amount: 3000 }],
      queue: 0,
      unmatch: 0,
      stateBytes: 200,
      parseOk: true,
    });
    expect(out).toEqual({ verdict: "OK", missing_n: 0, state_n: 3, hub_n: 1 });
  });

  it("허브 id 가 정산표에 없으면 MISSING", () => {
    const out = summarize({
      stateDonors: [{ id: "a", amount: 1000 }],
      hubLogs: [
        { id: "a", amount: 1000 },
        { id: "miss-1", amount: 5000 },
      ],
      queue: 0,
      unmatch: 0,
      stateBytes: 200,
      parseOk: true,
    });
    expect(out.verdict).toBe("MISSING");
    expect(out.missing_n).toBe(1);
  });

  it("정산표를 못 읽으면 0건이 아니라 STATE_FAIL", () => {
    const out = summarize({
      stateDonors: [],
      hubLogs: [],
      queue: 0,
      unmatch: 0,
      stateBytes: 0,
      parseOk: false,
    });
    expect(out.verdict).toBe("STATE_FAIL");
  });

  it("QUEUE/UNMATCH 대기는 누락이 아니라 BACKLOG", () => {
    const out = summarize({
      stateDonors: [{ id: "a", amount: 1 }],
      hubLogs: [{ id: "a", amount: 1 }],
      queue: 25,
      unmatch: 0,
      stateBytes: 80,
      parseOk: true,
    });
    expect(out.verdict).toBe("BACKLOG");
    expect(out.missing_n).toBe(0);
  });

  it("정산표의 toonation:din: 접두어는 허브 raw id 와 같은 후원이다", () => {
    const hubId = "toona.com:jydyej00us5jhp8gtw6k";
    const out = summarize({
      stateDonors: [{ id: `toonation:din:${hubId}`, externalId: hubId, amount: 1000 }],
      hubLogs: [{ id: hubId, amount: 1000 }],
      queue: 0,
      unmatch: 0,
      stateBytes: 200,
      parseOk: true,
    });
    expect(out).toEqual({ verdict: "OK", missing_n: 0, state_n: 1, hub_n: 1 });
  });
});
