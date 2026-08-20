import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import {
  buildSettlementRecordFromDonorExportXlsx,
  importMemberIdFromExportName,
} from "@/lib/settlement-donor-import";

describe("settlement-donor-import", () => {
  it("builds settlement from 건별내역 sheet rows", () => {
    const aoa = [
      ["정산제목", "정산시각", "멤버", "멤버실명", "후원자", "금액", "채널", "후원시각", "메시지"],
      ["깡깡대전 2화", "2026-08-15 20:44:23", "김프디", "", "당근", 300000, "투네", "2026-08-15 20:16:22", "테스트"],
      ["깡깡대전 2화", "2026-08-15 20:44:23", "김프디", "", "파파", 30000, "계좌", "2026-08-15 17:11:31", ""],
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "건별내역");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

    const rec = buildSettlementRecordFromDonorExportXlsx(buf, {
      recordId: "st_test_kkang",
    });
    expect(rec?.title).toBe("깡깡대전 2화");
    expect(rec?.donors).toHaveLength(2);
    expect(rec?.members.find((m) => m.name === "김프디")?.toon).toBe(300000);
    expect(rec?.members.find((m) => m.name === "김프디")?.account).toBe(30000);
    expect(rec!.totalGross).toBeGreaterThan(0);
  });

  it("importMemberIdFromExportName uses map when provided", () => {
    expect(importMemberIdFromExportName("현민", { 현민: "member-123" })).toBe("member-123");
    expect(importMemberIdFromExportName("현민")).toBe("imp_현민");
  });

  it("imports 깡깡대전 2화 xlsx from Downloads when present", () => {
    const xlsxPath = path.join(
      process.env.USERPROFILE || "",
      "Downloads",
      "깡깡대전 2화-멤버별후원자.xlsx"
    );
    if (!fs.existsSync(xlsxPath)) return;

    const buf = fs.readFileSync(xlsxPath);
    const rec = buildSettlementRecordFromDonorExportXlsx(buf, {
      recordId: "st_import_20260815_깡깡대전_2화",
    });
    expect(rec).not.toBeNull();
    expect(rec!.title).toBe("깡깡대전 2화");
    expect(rec!.donors!.length).toBe(53);
    expect(rec!.members.length).toBe(6);

    const outDir = path.join(process.cwd(), "recoveries");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, "깡깡대전-2화-settlement-import.json"),
      JSON.stringify([rec], null, 2),
      "utf8"
    );
  });
});
