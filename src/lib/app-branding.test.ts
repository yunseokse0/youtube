import { describe, expect, it } from "vitest";
import { APP_SYSTEM_NAME, adminHeaderTitle } from "./app-branding";

describe("adminHeaderTitle", () => {
  it("uses account name instead of DIN Studio brand", () => {
    expect(adminHeaderTitle({ id: "bttaeho", name: "BT태호", companyName: "DIN Studio" })).toBe(
      "BT태호 엑셀 방송 시스템"
    );
  });

  it("falls back to companyName then id", () => {
    expect(adminHeaderTitle({ id: "bttaeho", companyName: "BT스튜디오" })).toBe(
      "BT스튜디오 엑셀 방송 시스템"
    );
    expect(adminHeaderTitle({ id: "bttaeho" })).toBe("bttaeho 엑셀 방송 시스템");
  });

  it("falls back to product default when logged out", () => {
    expect(adminHeaderTitle(null)).toBe(APP_SYSTEM_NAME);
    expect(adminHeaderTitle({})).toBe(APP_SYSTEM_NAME);
  });
});
