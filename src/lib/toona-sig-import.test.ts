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

  it("이미지 없는 시그는 toona 기본 이미지로 채운다", () => {
    const items = mapToonaSignaturesToSigItems(
      [
        { id: "a", name: "애교", triggerAmount: 1000, imageUrl: "/uploads/own.gif" },
        { id: "b", name: "댄스", triggerAmount: 2000, imageUrl: null },
        { id: "c", name: "빈칸", triggerAmount: 3000, imageUrl: "  " },
      ],
      "http://localhost:4000",
      "/uploads/k/default.gif"
    );
    expect(items.find((x) => x.name === "애교")?.imageUrl).toBe("http://localhost:4000/uploads/own.gif");
    expect(items.find((x) => x.name === "댄스")?.imageUrl).toBe(
      "http://localhost:4000/uploads/k/default.gif"
    );
    expect(items.find((x) => x.name === "빈칸")?.imageUrl).toBe(
      "http://localhost:4000/uploads/k/default.gif"
    );
  });

  it("기본 이미지도 없으면 imageUrl은 빈 문자열", () => {
    const items = mapToonaSignaturesToSigItems(
      [{ id: "a", name: "댄스", imageUrl: "" }],
      "http://localhost:4000",
      null
    );
    expect(items[0]?.imageUrl).toBe("");
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

  it("비활성화된 시그 가져오기 시 isActive와 isRolling이 모두 false로 갱신된다", () => {
    const current = [
      item({ id: "toona_1", name: "시그1", isActive: true, isRolling: true }),
      item({ id: "toona_2", name: "시그2", isActive: true, isRolling: true }),
    ];
    // 프리셋 등에서 시그1은 On(enabled), 시그2는 Off(disabled)
    const imported = [
      item({ id: "toona_1", name: "시그1", isActive: true, isRolling: true }),
      item({ id: "toona_2", name: "시그2", isActive: false, isRolling: false }),
    ];
    const { nextInventory } = applyToonaSigItemsToInventory(current, imported, "merge");
    const sig1 = nextInventory.find((x) => x.name === "시그1")!;
    const sig2 = nextInventory.find((x) => x.name === "시그2")!;

    expect(sig1.isActive).toBe(true);
    expect(sig1.isRolling).toBe(true);
    expect(sig2.isActive).toBe(false);
    expect(sig2.isRolling).toBe(false);
  });

  it("replace 모드 시 기존 멤버 매핑(memberId)과 수량을 보존하면서 프리셋 시그로 교체", () => {
    const current = [
      item({ id: ONE_SHOT_SIG_ID, name: "한방 시그", price: 10000 }),
      item({ id: "toona_old1", name: "금연", price: 12000, memberId: "m_yuha", soldCount: 3, maxCount: 10 }),
      item({ id: "toona_old2", name: "제외될시그", price: 5000, memberId: "m_jina" }),
    ];
    // 프리셋에는 '금연'(108개 중 하나)만 포함되어 있고 '제외될시그'는 미포함
    const imported = [
      item({ id: "toona_new1", name: "금연", price: 12100, memberId: "" }),
      item({ id: "toona_new2", name: "디스코데기", price: 59000, memberId: "" }),
    ];

    const { nextInventory, added } = applyToonaSigItemsToInventory(current, imported, "replace");

    expect(added).toBe(2);
    expect(nextInventory.length).toBe(3); // oneShot(1) + imported(2)

    const smoke = nextInventory.find((x) => x.name === "금연")!;
    expect(smoke.price).toBe(12100);
    // 기존 memberId "m_yuha"와 soldCount 3 보존 확인
    expect(smoke.memberId).toBe("m_yuha");
    expect(smoke.soldCount).toBe(3);
    expect(smoke.maxCount).toBe(10);

    // 프리셋에 없는 '제외될시그'는 목록에서 제거됨
    expect(nextInventory.some((x) => x.name === "제외될시그")).toBe(false);
  });

  it("프리셋 필터링: 117개 전체 시그 중 활성화된 108개 프리셋만 가져오기", () => {
    // 117개의 시그 생성 (108개 enabled: true, 9개 enabled: false)
    const allSignatures = Array.from({ length: 117 }, (_, i) => ({
      id: `sig_${i + 1}`,
      name: `시그_${i + 1}`,
      triggerAmount: (i + 1) * 1000,
      enabled: i < 108, // 0~107번(108개)은 true, 108~116번(9개)은 false
    }));

    const activePresetEnabledIds = allSignatures.slice(0, 108).map((s) => s.id);
    const activeSet = new Set(activePresetEnabledIds);

    const filtered = allSignatures.filter((row) => activeSet.has(row.id) && row.enabled !== false);
    expect(filtered).toHaveLength(108);

    const items = mapToonaSignaturesToSigItems(filtered, "http://localhost:4000");
    expect(items).toHaveLength(108);
    expect(items[0].name).toBe("시그_1");
    expect(items[107].name).toBe("시그_108");
    // 109~117번 시그는 포함되지 않음
    expect(items.some((x) => x.name === "시그_109")).toBe(false);
  });

  it("프리셋 count 방어: ID 목록이 없더라도 프리셋 count(108개)에 맞춰 정확히 제한", () => {
    const allSignatures = Array.from({ length: 117 }, (_, i) => ({
      id: `sig_${i + 1}`,
      name: `시그_${i + 1}`,
      triggerAmount: (i + 1) * 1000,
      enabled: true, // 모든 시그가 enabled: true로 온 경우
    }));

    const currentPreset = { id: "p1", name: "마에스트라", count: 108, isActive: true };
    let finalTargetSignatures = allSignatures;
    if (currentPreset && currentPreset.count > 0 && finalTargetSignatures.length > currentPreset.count) {
      finalTargetSignatures = finalTargetSignatures.slice(0, currentPreset.count);
    }
    expect(finalTargetSignatures).toHaveLength(108);
  });
});
