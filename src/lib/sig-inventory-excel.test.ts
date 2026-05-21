import { describe, expect, it } from "vitest";
import { applySigPriceExcelRows, sigInventoryToExcelRows } from "@/lib/sig-inventory-excel";
import type { SigItem } from "@/types";

const baseItems: SigItem[] = [
  {
    id: "sig_a",
    name: "애교",
    price: 77000,
    imageUrl: "/uploads/sigs/u/a.gif",
    memberId: "",
    maxCount: 1,
    soldCount: 0,
    isRolling: true,
    isActive: true,
  },
  {
    id: "sig_b",
    name: "댄스",
    price: 100000,
    imageUrl: "/uploads/sigs/u/b.gif",
    memberId: "",
    maxCount: 2,
    soldCount: 1,
    isRolling: false,
    isActive: true,
  },
];

describe("sigInventoryToExcelRows", () => {
  it("exports Korean columns with current prices", () => {
    const rows = sigInventoryToExcelRows(baseItems, []);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: "sig_a", 이름: "애교", 가격: 77000, 판매활성: "Y" });
    expect(rows[1]?.가격).toBe(100000);
  });
});

describe("applySigPriceExcelRows", () => {
  it("updates price by id", () => {
    const { nextInventory, result } = applySigPriceExcelRows(baseItems, [{ id: "sig_a", 가격: 88000 }], []);
    expect(result.updated).toBe(1);
    expect(nextInventory.find((x) => x.id === "sig_a")?.price).toBe(88000);
  });

  it("updates price by name when id is missing", () => {
    const { nextInventory, result } = applySigPriceExcelRows(baseItems, [{ 이름: "댄스", price: 120000 }], []);
    expect(result.updated).toBe(1);
    expect(nextInventory.find((x) => x.id === "sig_b")?.price).toBe(120000);
  });

  it("reports rows that do not match inventory", () => {
    const { result } = applySigPriceExcelRows(baseItems, [{ 이름: "없는시그", 가격: 1 }], []);
    expect(result.updated).toBe(0);
    expect(result.notFound).toEqual(["없는시그"]);
  });
});
