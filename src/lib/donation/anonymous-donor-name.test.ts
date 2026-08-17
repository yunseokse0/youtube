import { describe, expect, it } from "vitest";
import {
  isAnonymousDonorPlaceholderName,
  normalizeAnonymousDonorDisplayName,
} from "./anonymous-donor-name";

describe("normalizeAnonymousDonorDisplayName", () => {
  it("maps Unknown variants to 익명", () => {
    expect(normalizeAnonymousDonorDisplayName("Unknown")).toBe("익명");
    expect(normalizeAnonymousDonorDisplayName("UNKNOWN")).toBe("익명");
    expect(normalizeAnonymousDonorDisplayName("unknown")).toBe("익명");
    expect(normalizeAnonymousDonorDisplayName(" Unknown ")).toBe("익명");
    expect(normalizeAnonymousDonorDisplayName("[Unknown]")).toBe("익명");
    expect(normalizeAnonymousDonorDisplayName("anonymous")).toBe("익명");
    expect(normalizeAnonymousDonorDisplayName("ANON")).toBe("익명");
    expect(normalizeAnonymousDonorDisplayName("익명")).toBe("익명");
  });

  it("keeps real nicknames", () => {
    expect(normalizeAnonymousDonorDisplayName("노가리7")).toBe("노가리7");
    expect(normalizeAnonymousDonorDisplayName("J p")).toBe("J p");
    expect(normalizeAnonymousDonorDisplayName("익명의천사")).toBe("익명의천사");
    expect(isAnonymousDonorPlaceholderName("익명의천사")).toBe(false);
  });

  it("empty → 무명", () => {
    expect(normalizeAnonymousDonorDisplayName("")).toBe("무명");
    expect(normalizeAnonymousDonorDisplayName("   ")).toBe("무명");
  });
});
