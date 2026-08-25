import { describe, expect, it } from "vitest";
import {
  applyToonaSigItemsToInventory,
  mapToonaSignaturesToSigItems,
  normalizeToonaApiBaseUrl,
  resolveToonaAssetUrl,
} from "@/lib/toona-sig-import";
import { ONE_SHOT_SIG_ID } from "@/lib/sig-roulette";
import type { SigItem } from "@/types";

function item(partial: Partial<SigItem> & Pick<SigItem, "id" | "name">): SigItem {
  return {
    price: 0,
    imageUrl: "",
    maxCount: 1,
    soldCount: 0,
    isActive: true,
    isRolling: true,
    ...partial,
  };
}

describe("resolveToonaAssetUrl", () => {
  it("절대 URL은 그대로", () => {
    expect(resolveToonaAssetUrl("https://cdn.example/a.gif", "http://localhost:4000")).toBe(
      "https://cdn.example/a.gif"
    );
  });

  it("상대 경로에 base를 붙임", () => {
    expect(resolveToonaAssetUrl("/uploads/k/signatures/a.gif", "http://localhost:4000/")).toBe(
      "http://localhost:4000/uploads/k/signatures/a.gif"
    );
  });
});

describe("normalizeToonaApiBaseUrl", () => {
  it("유효한 http(s)만 허용", () => {
    expect(normalizeToonaApiBaseUrl("http://13.125.221.195:4000/")).toBe(
      "http://13.125.221.195:4000"
    );
    expect(normalizeToonaApiBaseUrl("ftp://x")).toBeNull();
    expect(normalizeToonaApiBaseUrl("")).toBeNull();
  });
});

describe("mapToonaSignaturesToSigItems", () => {
  it("이름·금액·이미지를 매핑하고 이름 중복을 건너뜀", () => {
    const items = mapToonaSignaturesToSigItems(
      [
        { id: "a", name: "애교", triggerAmount: 77000, imageUrl: "/uploads/x.gif", sortOrder: 1 },
        { id: "b", name: " 애교 ", triggerAmount: 1, imageUrl: "/uploads/y.gif", sortOrder: 0 },
        { id: "c", name: "댄스", triggerAmount: null, enabled: false, sortOrder: 2 },
      ],
      "http://localhost:4000"
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: "toona_b",
      name: "애교",
      price: 1,
      imageUrl: "http://localhost:4000/uploads/y.gif",
    });
    expect(items[1]).toMatchObject({
      id: "toona_c",
      name: "댄스",
      price: 0,
      isActive: false,
    });
  });
});

describe("applyToonaSigItemsToInventory", () => {
  it("replace는 한방만 남기고 교체", () => {
    const current = [
      item({ id: ONE_SHOT_SIG_ID, name: "한방", price: 1 }),
      item({ id: "old", name: "옛시그", price: 10 }),
    ];
    const imported = [item({ id: "toona_1", name: "새시그", price: 20, imageUrl: "/a.gif" })];
    const { nextInventory, added } = applyToonaSigItemsToInventory(current, imported, "replace");
    expect(added).toBe(1);
    expect(nextInventory.map((x) => x.id)).toEqual([ONE_SHOT_SIG_ID, "toona_1"]);
  });

  it("merge는 이름 매칭 갱신·신규 추가", () => {
    const current = [
      item({ id: ONE_SHOT_SIG_ID, name: "한방" }),
      item({ id: "local1", name: "애교", price: 1000, soldCount: 2, maxCount: 5, imageUrl: "/old.gif" }),
    ];
    const imported = [
      item({ id: "toona_a", name: "애교", price: 77000, imageUrl: "/new.gif", isActive: true }),
      item({ id: "toona_b", name: "댄스", price: 5000 }),
    ];
    const { nextInventory, added, updated } = applyToonaSigItemsToInventory(
      current,
      imported,
      "merge"
    );
    expect(updated).toBe(1);
    expect(added).toBe(1);
    const aegyo = nextInventory.find((x) => x.name === "애교")!;
    expect(aegyo.id).toBe("local1");
    expect(aegyo.price).toBe(77000);
    expect(aegyo.imageUrl).toBe("/new.gif");
    expect(aegyo.soldCount).toBe(2);
    expect(aegyo.maxCount).toBe(5);
    expect(nextInventory.some((x) => x.name === "댄스")).toBe(true);
  });
});
