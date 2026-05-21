import type { Member, SigItem } from "@/types";

export type SigInventoryExcelRow = {
  id: string;
  이름: string;
  가격: number;
  최대수량: number;
  판매수: number;
  멤버: string;
  판매활성: string;
  롤링노출: string;
  이미지URL: string;
};

export type SigPriceExcelApplyResult = {
  updated: number;
  skipped: number;
  notFound: string[];
};

function yn(value: boolean): string {
  return value ? "Y" : "N";
}

function parseYn(raw: unknown, fallback: boolean): boolean {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return fallback;
  return s === "y" || s === "yes" || s === "true" || s === "1";
}

function normalizeSigNameKey(name: string): string {
  return String(name || "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function readRowName(row: Record<string, unknown>): string {
  return String(row.name ?? row["이름"] ?? "").trim();
}

function readRowId(row: Record<string, unknown>): string {
  return String(row.id ?? row["ID"] ?? row["id"] ?? "").trim();
}

function readRowPrice(row: Record<string, unknown>): number | null {
  const raw = row.price ?? row["가격"];
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const n = Math.floor(Number(raw) || 0);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export function sigInventoryToExcelRows(items: SigItem[], members: Member[]): SigInventoryExcelRow[] {
  const memberNameById = new Map((members || []).map((m) => [m.id, m.name.trim()]));
  return (items || []).map((item) => ({
    id: item.id,
    이름: item.name || "",
    가격: Math.max(0, Math.floor(Number(item.price || 0))),
    최대수량: Math.max(1, Math.floor(Number(item.maxCount || 1))),
    판매수: Math.max(0, Math.floor(Number(item.soldCount || 0))),
    멤버: memberNameById.get(String(item.memberId || "")) || "",
    판매활성: yn(Boolean(item.isActive)),
    롤링노출: yn(Boolean(item.isRolling)),
    이미지URL: String(item.imageUrl || "").trim(),
  }));
}

/** 기존 시그 행의 가격·설정을 엑셀으로 일괄 반영 (id 우선, 없으면 이름 매칭) */
export function applySigPriceExcelRows(
  inventory: SigItem[],
  rows: Record<string, unknown>[],
  members: Member[]
): { nextInventory: SigItem[]; result: SigPriceExcelApplyResult } {
  const memberMap = new Map((members || []).map((m) => [m.name.trim(), m.id]));
  const byId = new Map(inventory.map((x) => [x.id, x]));
  const byName = new Map(inventory.map((x) => [normalizeSigNameKey(x.name), x]));

  let updated = 0;
  let skipped = 0;
  const notFound: string[] = [];
  const nextInventory = inventory.map((item) => ({ ...item }));

  for (const row of rows) {
    const id = readRowId(row);
    const name = readRowName(row);
    if (!id && !name) {
      skipped += 1;
      continue;
    }

    let idx = -1;
    if (id) idx = nextInventory.findIndex((x) => x.id === id);
    if (idx < 0 && name) {
      const key = normalizeSigNameKey(name);
      const found = byName.get(key);
      if (found) idx = nextInventory.findIndex((x) => x.id === found.id);
    }
    if (idx < 0) {
      notFound.push(id || name);
      continue;
    }

    const current = nextInventory[idx]!;
    const price = readRowPrice(row);
    const maxRaw = row.maxCount ?? row["최대수량"];
    const memberName = String(row.memberName ?? row["멤버"] ?? "").trim();
    const hasActive = row.isActive !== undefined || row["판매활성"] !== undefined;
    const hasRolling = row.isRolling !== undefined || row["롤링노출"] !== undefined;
    const hasMax = maxRaw !== undefined && maxRaw !== null && String(maxRaw).trim() !== "";

    if (price == null && !hasMax && !memberName && !hasActive && !hasRolling) {
      skipped += 1;
      continue;
    }

    const next: SigItem = { ...current };
    if (price != null) next.price = price;
    if (hasMax) next.maxCount = Math.max(1, Math.floor(Number(maxRaw) || 1));
    if (memberName) next.memberId = memberMap.get(memberName) || "";
    if (hasActive) next.isActive = parseYn(row.isActive ?? row["판매활성"], next.isActive);
    if (hasRolling) next.isRolling = parseYn(row.isRolling ?? row["롤링노출"], next.isRolling);

    nextInventory[idx] = next;
    byId.set(next.id, next);
    byName.set(normalizeSigNameKey(next.name), next);
    updated += 1;
  }

  return {
    nextInventory,
    result: { updated, skipped, notFound },
  };
}
