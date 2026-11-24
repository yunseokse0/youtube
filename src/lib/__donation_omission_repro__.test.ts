import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { AppState, Donor } from "@/types";
import { defaultState } from "@/lib/state";
import {
  filterDonorsAfterSettlementReset,
  rebumpDonorsPastSettlementReset,
  applySettlementResetDonorPipeline,
} from "@/lib/state";
import { foldIngestEventsIntoState } from "@/lib/din-ingest-batch-fold";
import { sanitizeDonationEventFromIngestBody } from "@/lib/donation/din-ingest";
import { dropRebumpedPreResetDonors } from "@/lib/settlement-rebump-guard";
import { normalizeDonationEventId, isWeakToonationDonorId } from "@/domain/dedupe/donation-dedupe.rules";
import { dedupeDonorRows } from "@/domain/dedupe/donation-dedupe.pipeline";
import { normalizeDonorsArray } from "@/lib/state";

/**
 * 실서버(excel.heyob.co.kr) 재현 하네스.
 *  - 어제 저녁 10시경(2026-11-24 21:55 KST) 일일 로그 스냅샷 donors 32건을 기준 상태로 복원
 *  - 그 이후(정산 리셋 11-25 01:32:55 KST 이후) 유입 후원 재적용
 *  - 어느 단계에서 누락이 발생하는지 실측한다.
 */

const RESET_AT = 1795537975232; // 2026-11-25 01:32:55 KST (실서버 settlementResetAt)

const MEMBERS = [
  { id: "m1", name: "자키" },
  { id: "m2", name: "진아" },
  { id: "m3", name: "제킹" },
  { id: "m_1795422063042_9sje4", name: "수린" },
  { id: "m_1795422066838_ysjeg", name: "채영" },
  { id: "m_1795422070009_lacdm", name: "초화" },
  { id: "m_1795428176889_83rww", name: "이나" },
  { id: "m_1795515529988_zardj", name: "서유하" },
];

const donor = (
  id: string,
  name: string,
  amount: number,
  memberId: string,
  at: number,
  message: string
): Donor => ({ id, name, amount, memberId, at, target: "toon", message });

/** 2026-11-24 21:55 KST 스냅샷 (donorCount=32, 실서버 일일 로그 실측값) */
const SNAPSHOT_32: Donor[] = [
  donor("bank:sms:cmwup5mbp004z5jqlnn2211d0", "집집집", 52000, "m1", 1795524882757, "대표자키 화이팅"),
  donor("bank:sms:cmwuogo5x00195jqlkvfeqaat", "마에스트라", 26000, "m_1795515529988_zardj", 1795523718742, "후원 테스트 입니다."),
  donor("bank:sms:cmwumc5ug002x5jt1bqucs5ma", "마에스트라", 333000, "m2", 1795520149144, "진아"),
  donor("bank:sms:cmwulzyvc002f5jt1762jelgi", "마에스트라", 220000, "m2", 1795519580232, "진아"),
  donor("bank:sms:cmwulz2tt00265jt16f8lzxyi", "마에스트라", 31000, "m_1795515529988_zardj", 1795519538705, "후원 테스트 입니다."),
  donor("bank:sms:cmwulqi6j001t5jt1q5id1y41", "마에스트라", 500000, "m_1795515529988_zardj", 1795519138699, "후원 테스트 입니다."),
  donor("bank:sms:cmwulpu57001k5jt1814vv3cj", "마에스트라", 1650000, "m_1795515529988_zardj", 1795519107548, "후원 테스트 입니다."),
  donor("bank:sms:cmwulnt82001b5jt1qnz2gayl", "마에스트라", 1350000, "m_1795515529988_zardj", 1795519013042, "후원 테스트 입니다."),
  donor("bank:1795518478880-ine75p-20000000", "123123", 20000000, "m_1795515529988_zardj", 1795518478881, "1313"),
  donor("bank:1795518446337-2vcreu-10000000", "11111", 10000000, "m_1795422066838_ysjeg", 1795518446337, "11111"),
  donor("bank:sms:cmwul6qnz00985jawabn76f6o", "마에스트라", 10000000, "m_1795422066838_ysjeg", 1795518216576, "채영 화이팅"),
  donor("bank:sms:cmwul2q9j007v5jaw675u3ccz", "마에스트라", 66000, "m2", 1795518029432, "진아 화이팅"),
  donor("bank:sms:cmwukxpoi005u5jawkckd84ix", "마에스트라", 92000, "m_1795515529988_zardj", 1795517795394, "서유하 화이팅"),
  donor("bank:sms:cmwukpzas004l5jaw414e9fgi", "마에스트라", 95000, "m_1795515529988_zardj", 1795517434612, "서유하 화이팅"),
  donor("bank:sms:cmwuko44h003u5jawx4ba5jg3", "마에스트라", 195000, "m_1795515529988_zardj", 1795517347554, "서유하 화이팅"),
  donor("bank:sms:cmwukf4wo003h5jawfaqvt6z0", "마에스트라", 36000, "m2", 1795516928664, "후원 테스트 입니다."),
  donor("bank:sms:cmwukels400385jawkeg5m7zl", "마에스트라", 52000, "m2", 1795516903877, "후원 테스트 입니다."),
  donor("bank:sms:cmwt5r3w100575jg5byxcuh9e", "우마에3579", 234000, "m_1795428176889_83rww", 1795431826801, "후원 테스트 입니다."),
  donor("bank:sms:cmwt5qo8s004u5jg5bihunp8j", "자키집마에", 31000, "m_1795428176889_83rww", 1795431806525, "후원 테스트 입니다."),
  donor("bank:sms:cmwt5puen004f5jg5fjiwktnp", "팔구십십일", 32000, "m1", 1795431767855, "자키 테스트입니다."),
  donor("bank:sms:cmwt5pg4300425jg5v9u79zdq", "삼사오육칠", 52000, "m1", 1795431749332, "자키 테스트입니다."),
  donor("bank:sms:cmwt5p4hm003t5jg505qtn1xe", "렛츠고", 92000, "m1", 1795431734266, "자키 테스트입니다."),
  donor("bank:sms:cmwt5oo5p003k5jg546h9bom9", "빵빵띠띠", 32000, "m_1795428176889_83rww", 1795431713102, "후원 테스트 입니다."),
  donor("bank:sms:cmwt5oce6003b5jg5yohpwmiq", "띠띠빵빵", 29999, "m_1795428176889_83rww", 1795431697854, "후원 테스트 입니다."),
  donor("bank:sms:cmwt5nz39002y5jg5mla3xr4w", "23345", 31000, "m_1795428176889_83rww", 1795431680613, "후원 테스트 입니다."),
  donor("bank:sms:cmwt5nt43002p5jg5gal5i7cd", "123456", 333000, "m_1795428176889_83rww", 1795431672867, "후원 테스트 입니다."),
  donor("bank:sms:cmwt5gh94001y5jg55lj8w7ju", "마에스트라", 195000, "m_1795428176889_83rww", 1795431330904, "후원 테스트 입니다."),
  donor("bank:sms:cmwt5fwlr001p5jg5k7p2eg1y", "마에스트라", 35000, "m_1795428176889_83rww", 1795431304143, "후원 테스트 입니다."),
  donor("bank:sms:cmwt5dgpv00165jg5mtqmobs1", "마에스트라", 32000, "m_1795428176889_83rww", 1795431190243, "후원 테스트 입니다."),
  donor("bank:sms:cmwt5ce3w000x5jg54rmxvszc", "마에스트라", 95000, "m_1795428176889_83rww", 1795431140204, "후원 테스트 입니다."),
  donor("bank:sms:cmwt5cang000o5jg5gy3sv1zc", "마에스트라", 333000, "m_1795428176889_83rww", 1795431135724, "후원 테스트 입니다."),
  donor("bank:sms:cmwt5c68m000f5jg5cqm6uqld", "마에스트라", 31000, "m_1795428176889_83rww", 1795431130007, "후원 테스트 입니다."),
];

/** 리셋(01:32:55) 이후 유입된 실서버 4건 */
const LATER_4: Donor[] = [
  donor("bank:sms:cmwux1ykd000m5jqsot5wd2y1", "마에스트라", 32000, "m1", 1795538148925, "자키"),
  donor("bank:sms:cmwux75wj00145jqsf2i49thr", "마에스트라", 35000, "m1", 1795538391715, "자키"),
  donor("bank:sms:cmwuyydca002d5jqsodbw469g", "마에스트라", 1069000, "m2", 1795541340683, "진아"),
  donor("bank:sms:cmwuyzl77002m5jqsob1kckmi", "마에스트라", 52000, "m2", 1795541397524, "진아"),
];

/** toona 는 externalId 를 name:amount 로 결정적으로 발급한다 (실서버 ext=test:<base64>) */
function toonaExternalId(name: string, amount: number): string {
  return `test:${Buffer.from(`${name}:${amount}`, "utf8").toString("base64")}`;
}

const baseMembers = () =>
  MEMBERS.map((m) => ({ ...m, account: 0, toon: 0, contribution: 0, goal: 500000 })) as AppState["members"];

const buildState = (donors: Donor[], settlementResetAt = 0): AppState =>
  ({ ...defaultState(), members: baseMembers(), donors, settlementResetAt }) as AppState;

/** 푸시(ingest) 경로 이벤트 — id 는 bank:sms:<cuid> 그대로 온다 */
const pushEvent = (d: Donor) =>
  sanitizeDonationEventFromIngestBody({
    id: `sms:${d.id.replace(/^bank:sms:/, "")}`,
    externalId: toonaExternalId(String(d.name), Number(d.amount)),
    provider: "bank",
    donorName: d.name,
    amount: d.amount,
    memberId: d.memberId,
    message: d.message,
    at: new Date(Number(d.at)).toISOString(),
  })!;

/**
 * 허브 pull 경로 이벤트.
 *  toona 허브 GET /api/donations/{streamKey} 는 prisma donation PK(cuid) 를 row.id 로 반환하고,
 *  toonaHubDonationToEvent 는 externalId = row.id, id = `${provider}:din:${row.id}` 로 매핑한다.
 *  → 따라서 pull 의 id/externalId 는 후원별 고유 cuid 이다(결정적 externalId 가 아니다).
 */
const pullEvent = (d: Donor) => {
  const cuid = d.id.replace(/^bank:sms:/, "");
  return sanitizeDonationEventFromIngestBody({
    id: `bank:din:${cuid}`,
    externalId: cuid,
    provider: "bank",
    donorName: d.name,
    amount: d.amount,
    memberId: d.memberId,
    message: d.message,
    at: new Date(Number(d.at)).toISOString(),
  })!;
};

describe("[REPRO] 후원 누락 재현 (실서버 21:55 스냅샷 복원 + 이후 유입 재적용)", () => {
  it("스냅샷 32건은 모두 bank:sms: Strong ID 로 판정되어야 한다", () => {
    for (const d of SNAPSHOT_32) {
      expect(isWeakToonationDonorId(d.id)).toBe(false);
    }
    expect(SNAPSHOT_32.length).toBe(32);
  });

  it("[TC7] 저장/정규화 dedupe 가 스냅샷 32건을 축소하지 않아야 한다", () => {
    expect(normalizeDonorsArray(SNAPSHOT_32).length).toBe(32);
    expect(dedupeDonorRows(SNAPSHOT_32).length).toBe(32);
  });

  it("[TC8] 스냅샷 32건을 hub pull(bank:din:<cuid>) 로 재생하면 32건이어야 한다", () => {
    const events = SNAPSHOT_32.map(pullEvent);
    let s = buildState([]);
    const droppedIdx: number[] = [];
    for (let i = 0; i < events.length; i++) {
      const r = foldIngestEventsIntoState(s, [events[i]]);
      if (r.applied.length === 0) droppedIdx.push(i);
      else s = r.state;
    }
    console.log(
      "[TC8] kept=%d dropped=%d",
      s.donors.length,
      32 - s.donors.length
    );
    console.log(
      "[TC8] droppedEvents=%s",
      JSON.stringify(
        droppedIdx.map((i) => ({
          i,
          name: events[i].donorName,
          amount: events[i].amount,
          at: events[i].at,
          id: events[i].id,
          msg: events[i].message,
          ext: events[i].externalId,
        }))
      )
    );
    console.log(
      "[TC8] keptEvents=%s",
      JSON.stringify(
        s.donors.map((d) => ({ id: d.id, name: d.name, amount: d.amount, at: d.at }))
      )
    );
    expect(s.donors.length).toBe(32);
  });

  it("[TC9] 스냅샷 32건을 push(bank:sms:<cuid>) 로 재생하면 32건이어야 한다", () => {
    const events = SNAPSHOT_32.map(pushEvent);
    const result = foldIngestEventsIntoState(buildState([]), events);
    expect(result.applied.length).toBe(32);
  });

  it("[TC10] 같은 후원이 push(bank:sms:<cuid>) 로 먼저 들어온 뒤 pull(bank:din:<cuid>) 로 다시 들어오면 1건으로 dedupe 되어야 한다", () => {
    const d = SNAPSHOT_32[0]; // 집집집 52000
    const pushRes = foldIngestEventsIntoState(buildState([]), [pushEvent(d)]);
    expect(pushRes.state.donors.length).toBe(1);
    const pullRes = foldIngestEventsIntoState(pushRes.state, [pullEvent(d)]);
    // 정규화 id 가 둘 다 <cuid> 로 동일 → 별개 후원으로 늘어나면 안 된다
    expect(pullRes.state.donors.length).toBe(1);
    expect(pullRes.applied.length).toBe(0);
  });

  it("[TC1] 복원된 32건 위에 리셋 이후 4건(push) 을 fold 하면 36건이어야 한다", () => {
    const base = buildState(SNAPSHOT_32);
    const events = LATER_4.map(pushEvent);
    const result = foldIngestEventsIntoState(base, events);
    expect(result.discardedReset).toBe(0);
    expect(result.state.donors.length).toBe(36);
  });

  it("[TC2] 복원된 32건 위에 리셋 이후 4건(hub pull: bank:din:<ext>) 을 fold 하면 36건이어야 한다", () => {
    const base = buildState(SNAPSHOT_32);
    const events = LATER_4.map(pullEvent);
    const result = foldIngestEventsToStateSafe(base, events);
    expect(result.state.donors.length).toBe(36);
  });

  it("[TC3] 같은 후원자·같은 금액 반복 후원(마에스트라 52000 ×2, 다른 cuid)은 2건 모두 반영되어야 한다", () => {
    const base = buildState(SNAPSHOT_32);
    const events = LATER_4.filter((d) => d.amount === 52000 || d.amount === 35000).map(pushEvent);
    const result = foldIngestEventsIntoState(base, events);
    // 마에스트라 52000 은 cmwukels4(기존) + cmwuyzl77(신규) 로 2건이어야 한다
    const dup = result.state.donors.filter((d) => d.name === "마에스트라" && d.amount === 52000);
    expect(dup.length).toBe(2);
  });

  it("[TC4] 정산 리셋 이후 스냅샷 복원(rebump) 후 필터를 통과해야 한다", () => {
    const rebumped = rebumpDonorsPastSettlementReset(SNAPSHOT_32, RESET_AT);
    const surviving = filterDonorsAfterSettlementReset(rebumped, RESET_AT);
    expect(surviving.length).toBe(32);
  });

  it("[TC5] 리셋 전 스냅샷을 rebump 없이 저장 파이프라인에 태우면 전량 탈락한다(누락 재현)", () => {
    const surviving = applySettlementResetDonorPipeline(SNAPSHOT_32, RESET_AT);
    expect(surviving.length).toBe(0);
  });

  it("[TC6] 복원 직후 non-restore persist 가 rebump 구간 후원을 다시 버리는지", () => {
    const server = buildState(SNAPSHOT_32, RESET_AT);
    const rebumped = rebumpDonorsPastSettlementReset(SNAPSHOT_32, RESET_AT);
    const browser = buildState(rebumped, RESET_AT);
    const guarded = dropRebumpedPreResetDonors(browser, server);
    expect(guarded.dropped).toBe(0);
    expect(guarded.state.donors.length).toBe(32);
  });
});

/** fold 를 명시적으로 호출하는 헬퍼 (TC2 가독성) */
function foldIngestEventsToStateSafe(base: AppState, events: ReturnType<typeof pushEvent>[]) {
  return foldIngestEventsIntoState(base, events);
}
