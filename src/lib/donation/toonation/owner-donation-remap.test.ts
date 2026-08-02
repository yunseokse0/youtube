import { describe, expect, it } from "vitest";
import {
  applyOwnerDonationRemapIfNeeded,
  normalizeOwnerNameForCompare,
  parseOwnerAccountMessageBody,
  remapOwnerSelfDonationAsAccount,
} from "./owner-donation-remap";
import type { DonationEvent } from "../types";

function toonEvent(overrides: Partial<DonationEvent> = {}): DonationEvent {
  return {
    id: "toonation:test-1",
    provider: "toonation",
    externalId: "ext-1",
    donorName: "BT태호",
    amount: 10000,
    message: "",
    at: new Date().toISOString(),
    target: "toon",
    status: "queued",
    ...overrides,
  };
}

describe("owner-donation-remap", () => {
  it("normalizes honorific suffix for owner compare", () => {
    expect(normalizeOwnerNameForCompare("BT태호님")).toBe(normalizeOwnerNameForCompare("BT태호"));
  });

  it("parseOwnerAccountMessageBody: 계좌 접두 중간 이후", () => {
    expect(parseOwnerAccountMessageBody("후원 계좌 익명 태호")).toEqual({
      donorName: "익명",
      playerName: "태호",
      restMessage: "",
    });
  });

  it("parseOwnerAccountMessageBody: 익명 홍쓰", () => {
    expect(parseOwnerAccountMessageBody("익명 홍쓰")).toEqual({
      donorName: "익명",
      playerName: "홍쓰",
      restMessage: "",
    });
  });

  it("parseOwnerAccountMessageBody: 익명 홍쓰 감사합니다", () => {
    expect(parseOwnerAccountMessageBody("익명 홍쓰 감사합니다")).toEqual({
      donorName: "익명",
      playerName: "홍쓰",
      restMessage: "감사합니다",
    });
  });

  it("owner alert nick → account, message splits donor/member", () => {
    const owners = new Set([normalizeOwnerNameForCompare("BT태호")]);
    const out = applyOwnerDonationRemapIfNeeded(
      toonEvent({ donorName: "BT태호", message: "익명 홍쓰" }),
      owners
    );
    expect(out.target).toBe("account");
    expect(out.donorName).toBe("익명");
    expect(out.playerName).toBe("홍쓰");
    expect(out.message).toBe("");
  });

  it("remaps owner with honorific alert nick", () => {
    const owners = new Set([normalizeOwnerNameForCompare("BT태호")]);
    const out = applyOwnerDonationRemapIfNeeded(
      toonEvent({ donorName: "BT태호님", message: "익명 BT태호" }),
      owners
    );
    expect(out.target).toBe("account");
    expect(out.donorName).toBe("익명");
    expect(out.playerName).toBe("BT태호");
  });

  it("does not remap unrelated donor (일반 투네)", () => {
    const owners = new Set([normalizeOwnerNameForCompare("BT태호")]);
    const out = applyOwnerDonationRemapIfNeeded(
      toonEvent({ donorName: "시청자", message: "BT태호 화이팅" }),
      owners
    );
    expect(out.target).toBe("toon");
    expect(out.donorName).toBe("시청자");
  });

  it("explicit 계좌 format skips prefix token", () => {
    const out = remapOwnerSelfDonationAsAccount(
      toonEvent({ message: "계좌 익명 BT태호", playerName: undefined })
    );
    expect(out.target).toBe("account");
    expect(out.donorName).toBe("익명");
    expect(out.playerName).toBe("BT태호");
  });

  it("already account format is unchanged", () => {
    const evt = toonEvent({ target: "account", message: "계좌 익명 BT태호" });
    const owners = new Set([normalizeOwnerNameForCompare("BT태호")]);
    expect(applyOwnerDonationRemapIfNeeded(evt, owners)).toEqual(evt);
  });
});
