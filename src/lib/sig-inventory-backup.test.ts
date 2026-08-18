import { describe, expect, it } from "vitest";
import { DEFAULT_SIG_INVENTORY } from "@/lib/constants";
import { hasExpandedSigInventory } from "@/lib/state";
import { shouldRestoreSigInventoryFromBackup } from "@/lib/sig-inventory-backup";
import type { SigItem } from "@/types";

function customSig(id: string, name: string): SigItem {
  return {
    id,
    name,
    price: 1000,
    imageUrl: "",
    memberId: "",
    maxCount: 1,
    soldCount: 0,
    isRolling: true,
    isActive: true,
  };
}

describe("sig inventory backup", () => {
  const expanded = [
    ...DEFAULT_SIG_INVENTORY.map((x) => ({ ...x })),
    customSig("sig_custom", "04클럽춤"),
  ];

  it("restores when main state reverted to default preset", () => {
    const current = DEFAULT_SIG_INVENTORY.map((x) => ({ ...x }));
    expect(shouldRestoreSigInventoryFromBackup(current, expanded)).toBe(true);
    expect(hasExpandedSigInventory(expanded)).toBe(true);
  });

  it("restores when main state is a strict subset of backup", () => {
    const backup = [
      ...DEFAULT_SIG_INVENTORY.map((x) => ({ ...x })),
      customSig("sig_custom_a", "04클럽춤"),
      customSig("sig_custom_b", "05댄스"),
    ];
    const current = [
      ...DEFAULT_SIG_INVENTORY.map((x) => ({ ...x })),
      customSig("sig_custom_a", "04클럽춤"),
    ];
    expect(shouldRestoreSigInventoryFromBackup(current, backup)).toBe(true);
  });

  it("does not restore when main state is current", () => {
    expect(shouldRestoreSigInventoryFromBackup(expanded, expanded)).toBe(false);
  });

  it("does not restore when backup is not expanded", () => {
    const defaults = DEFAULT_SIG_INVENTORY.map((x) => ({ ...x }));
    expect(shouldRestoreSigInventoryFromBackup(defaults, defaults)).toBe(false);
  });
});
