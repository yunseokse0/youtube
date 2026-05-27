import { describe, expect, it } from "vitest";
import {
  collectDuplicateItemIds,
  findLocalSigDuplicateGroups,
  listFromDriveFilesNotInCatalog,
} from "@/lib/local-sig-dedup";
import type { LocalSigCatalogEntry } from "@/lib/local-sig-catalog";

const base = (p: Partial<LocalSigCatalogEntry>): LocalSigCatalogEntry => ({
  id: p.id || "a",
  name: p.name || "테스트",
  price: p.price ?? 10000,
  file: p.file || "test.gif",
  imageUrl: p.imageUrl || "/images/sigs/from-drive/test.gif",
  ...p,
});

describe("local-sig-dedup", () => {
  it("detects duplicate names", () => {
    const items = [
      base({ id: "1", name: "콩나물" }),
      base({ id: "2", name: "콩나물", file: "other.gif", imageUrl: "/x/other.gif" }),
    ];
    const groups = findLocalSigDuplicateGroups(items);
    expect(groups.some((g) => g.reason === "name")).toBe(true);
    expect(collectDuplicateItemIds(groups).size).toBe(2);
  });

  it("lists from-drive files not in catalog", () => {
    const catalog = [base({ file: "a.gif", name: "a" })];
    const out = listFromDriveFilesNotInCatalog(["a.gif", "b.gif"], catalog);
    expect(out).toEqual(["b.gif"]);
  });
});
