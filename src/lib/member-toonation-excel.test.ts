import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import type { Donor } from "@/types";
import {
  fileLabelFromName,
  mergeDonorsWithMissingAccount,
  parseMemberExcelTime,
  parseMemberToonationExcelAoA,
  parseMemberToonationExcelBuffer,
  reconcileMemberToonationExcels,
  resolveMemberFromExcelLabel,
  scoreMemberExcelRowAgainstDonor,
} from "@/lib/member-toonation-excel";

const MEMBERS = [
  { id: "m_haru", name: "하루" },
  { id: "m_harin", name: "오하린" },
  { id: "m_dayul", name: "진다율" },
];

function donor(partial: Partial<Donor> & Pick<Donor, "id" | "name" | "amount" | "memberId">): Donor {
  return {
    at: 0,
    target: "account",
    ...partial,
  };
}

describe("member-toonation-excel", () => {
  it("resolves kakao filenames to settlement members", () => {
    expect(resolveMemberFromExcelLabel("오류난하루", MEMBERS)?.id).toBe("m_haru");
    expect(resolveMemberFromExcelLabel("오하린", MEMBERS)?.id).toBe("m_harin");
    expect(resolveMemberFromExcelLabel("다율", MEMBERS)?.id).toBe("m_dayul");
    expect(fileLabelFromName("김라라.xlsx")).toBe("김라라");
  });

  it("parses Time/Name/Amount/Message and splits 계좌 구간 after 투네이션 합계", () => {
    const parsed = parseMemberToonationExcelAoA(
      [
        ["Time", " Name", " Amount", " Message"],
        ["2026.09.23 23:50:56", "자키집고양이", 100000, "하루부장님 월클"],
        ["", "투네이션 합계", 1280700, ""],
        ["2026.09.23 18:10:36", "간지민수/하루", 100000, ""],
        ["2026.09.23 17:52:27", "퓨리/하루♡", 55000, ""],
        ["", "계좌합계", 341700, ""],
      ],
      "오류난하루"
    );
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows[0]?.section).toBe("toon");
    expect(parsed.rows[1]?.section).toBe("account");
    expect(parsed.rows[1]?.name).toBe("간지민수/하루");
    expect(parsed.rows[2]?.section).toBe("account");
    expect(parsed.toonTotal).toBe(1280700);
    expect(parsed.accountTotal).toBe(341700);
    expect(parsed.rows[1]?.at).toBe(Date.parse("2026-09-23T18:10:36+09:00"));
  });

  it("parses xlsx buffer", () => {
    const aoa = [
      ["Time", "Name", "Amount", "Message"],
      ["2026.09.23 18:10:36", "간지민수/하루", 100000, ""],
      ["", "투네이션 합계", 100000, ""],
      ["2026.09.23 18:10:36", "간지민수/하루", 100000, ""],
      ["", "계좌합계", 100000, ""],
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Sheet1");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;
    const parsed = parseMemberToonationExcelBuffer(buf, "오류난하루");
    expect(parsed.rows.some((r) => r.section === "account" && r.name.includes("간지민수"))).toBe(true);
  });

  it("matches concatenated excel name to split settlement name+message (SMS delay)", () => {
    const row = {
      at: Date.parse("2026-09-23T18:30:17+09:00"),
      name: "단비윤 오하린 살아",
      amount: 65000,
      message: "",
      section: "account" as const,
    };
    const existing = donor({
      id: "d1",
      name: "단비윤",
      message: "오하린 살아",
      amount: 65000,
      memberId: "m_harin",
      target: "account",
      at: Date.parse("2026-09-23T18:39:58+09:00"),
    });
    expect(scoreMemberExcelRowAgainstDonor(row, existing)).toBeGreaterThanOrEqual(70);
  });

  it("matches 계좌 엑셀 행 to 박자키 투네 message (does not treat as missing)", () => {
    const row = {
      at: Date.parse("2026-09-23T19:31:05+09:00"),
      name: "구름 진다율",
      amount: 15100,
      message: "",
      section: "account" as const,
    };
    const toon = donor({
      id: "d-toon",
      name: "박자키",
      message: "구름 진다율",
      amount: 15100,
      memberId: "m_dayul",
      target: "toon",
      at: Date.parse("2026-09-23T19:31:28+09:00"),
    });
    expect(scoreMemberExcelRowAgainstDonor(row, toon)).toBeGreaterThanOrEqual(70);
  });

  it("flags only true SMS-missing account rows from the 0923 pattern", () => {
    const haru = parseMemberToonationExcelAoA(
      [
        ["Time", "Name", "Amount", "Message"],
        ["2026.09.23 23:50:56", "자키집고양이", 100000, "하루부장님 월클"],
        ["", "투네이션 합계", 100000, ""],
        ["2026.09.23 18:10:36", "간지민수/하루", 100000, ""],
        ["2026.09.23 17:52:27", "퓨리/하루♡", 55000, ""],
        ["", "계좌합계", 155000, ""],
      ],
      "오류난하루"
    );
    const harin = parseMemberToonationExcelAoA(
      [
        ["Time", "Name", "Amount", "Message"],
        ["", "투네이션 합계", 0, ""],
        ["2026.09.23 18:30:17", "단비윤 오하린 살아", 65000, ""],
        ["", "계좌합계", 65000, ""],
      ],
      "오하린"
    );
    const dayul = parseMemberToonationExcelAoA(
      [
        ["Time", "Name", "Amount", "Message"],
        ["", "투네이션 합계", 0, ""],
        ["2026.09.23 18:23:47", "구름 진다율", 55000, ""],
        ["2026.09.23 19:31:05", "구름 진다율", 15100, ""],
        ["2026.09.23 19:30:17", "구름 진다율", 15100, ""],
        ["", "계좌합계", 85200, ""],
      ],
      "다율"
    );
    const donors: Donor[] = [
      donor({
        id: "d-fury",
        name: "퓨리/하루♡",
        amount: 55000,
        memberId: "m_haru",
        target: "account",
        at: Date.parse("2026-09-23T17:52:29+09:00"),
      }),
      donor({
        id: "d-danbi",
        name: "단비윤",
        message: "오하린 살아",
        amount: 65000,
        memberId: "m_harin",
        target: "account",
        at: Date.parse("2026-09-23T18:39:58+09:00"),
      }),
      donor({
        id: "d-cloud-acc",
        name: "구름",
        message: "진다율",
        amount: 55000,
        memberId: "m_dayul",
        target: "account",
        at: Date.parse("2026-09-23T18:39:58+09:00"),
      }),
      donor({
        id: "d-cloud-151-acc",
        name: "구름",
        message: "진다율",
        amount: 15100,
        memberId: "m_dayul",
        target: "account",
        at: Date.parse("2026-09-23T19:30:20+09:00"),
      }),
      donor({
        id: "d-cloud-151-toon",
        name: "박자키",
        message: "구름 진다율",
        amount: 15100,
        memberId: "m_dayul",
        target: "toon",
        at: Date.parse("2026-09-23T19:31:28+09:00"),
      }),
      donor({
        id: "d-cat",
        name: "자키집고양이",
        message: "하루부장님 월클",
        amount: 100000,
        memberId: "m_haru",
        target: "toon",
        at: Date.parse("2026-09-23T23:50:56+09:00"),
      }),
    ];
    const result = reconcileMemberToonationExcels([haru, harin, dayul], MEMBERS, donors);
    expect(result.missingAccount).toHaveLength(1);
    expect(result.missingAccount[0]?.name).toBe("간지민수/하루");
    expect(result.missingAccount[0]?.amount).toBe(100000);
    expect(result.missingAccount[0]?.memberId).toBe("m_haru");
    expect(result.missingDonors).toHaveLength(1);
    expect(result.missingDonors[0]?.target).toBe("account");
    const merged = mergeDonorsWithMissingAccount(donors, result.missingDonors);
    expect(merged).toHaveLength(donors.length + 1);
    const again = reconcileMemberToonationExcels([haru, harin, dayul], MEMBERS, merged);
    expect(again.missingAccount).toHaveLength(0);
  });

  it("treats empty-message rows as account when 합계 표가 없으면", () => {
    const parsed = parseMemberToonationExcelAoA(
      [
        ["Time", "Name", "Amount", "Message"],
        ["2026.09.23 18:10:36", "간지민수/하루", 100000, ""],
        ["2026.09.23 23:50:56", "자키집고양이", 100000, "하루부장님"],
      ],
      "오류난하루"
    );
    expect(parsed.rows.find((r) => r.name === "간지민수/하루")?.section).toBe("account");
    expect(parsed.rows.find((r) => r.name === "자키집고양이")?.section).toBe("toon");
  });

  it("parseMemberExcelTime reads KST dotted datetime", () => {
    expect(parseMemberExcelTime("2026.09.23 18:10:36")).toBe(Date.parse("2026-09-23T18:10:36+09:00"));
  });
});
