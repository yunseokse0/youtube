import type { LocalSigCatalogEntry } from "@/lib/local-sig-catalog";

export type LocalSigDuplicateReason = "name" | "file" | "imageUrl" | "namePrice";

export type LocalSigDuplicateGroup = {
  reason: LocalSigDuplicateReason;
  reasonLabel: string;
  key: string;
  itemIds: string[];
  items: LocalSigCatalogEntry[];
};

export function normalizeLocalSigNameKey(name: string): string {
  return String(name || "")
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();
}

export function localSigFileBaseKey(fileOrUrl: string): string {
  const raw = String(fileOrUrl || "").trim();
  if (!raw) return "";
  try {
    const pathPart = raw.includes("/") ? raw.split("?")[0] : raw;
    const base = pathPart.split("/").filter(Boolean).pop() || pathPart;
    return decodeURIComponent(base).toLowerCase();
  } catch {
    return raw.split("/").pop()?.toLowerCase() || raw.toLowerCase();
  }
}

export function localSigImagePathKey(imageUrl: string): string {
  const raw = String(imageUrl || "").trim();
  if (!raw) return "";
  try {
    const u = raw.startsWith("http") ? new URL(raw) : new URL(raw, "http://local");
    return u.pathname.replace(/\/+/g, "/").toLowerCase();
  } catch {
    return raw.split("?")[0].replace(/\\/g, "/").toLowerCase();
  }
}

function groupByKey(
  items: LocalSigCatalogEntry[],
  keyFn: (item: LocalSigCatalogEntry) => string,
  reason: LocalSigDuplicateReason,
  reasonLabel: string
): LocalSigDuplicateGroup[] {
  const map = new Map<string, LocalSigCatalogEntry[]>();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    const list = map.get(key) || [];
    list.push(item);
    map.set(key, list);
  }
  const out: LocalSigDuplicateGroup[] = [];
  for (const [key, group] of map) {
    if (group.length < 2) continue;
    out.push({
      reason,
      reasonLabel,
      key,
      itemIds: group.map((x) => x.id),
      items: group,
    });
  }
  return out;
}

/** 목록 내 중복 그룹 (이름 / 파일명 / 이미지 경로 / 이름+가격) */
export function findLocalSigDuplicateGroups(
  items: LocalSigCatalogEntry[]
): LocalSigDuplicateGroup[] {
  const groups = [
    ...groupByKey(
      items,
      (i) => normalizeLocalSigNameKey(i.name),
      "name",
      "이름 동일"
    ),
    ...groupByKey(
      items,
      (i) => localSigFileBaseKey(i.file || i.imageUrl),
      "file",
      "파일명 동일"
    ),
    ...groupByKey(
      items,
      (i) => localSigImagePathKey(i.imageUrl),
      "imageUrl",
      "이미지 URL 동일"
    ),
    ...groupByKey(
      items,
      (i) => `${normalizeLocalSigNameKey(i.name)}|${Math.floor(i.price || 0)}`,
      "namePrice",
      "이름+가격 동일"
    ),
  ];
  groups.sort((a, b) => b.items.length - a.items.length || a.reason.localeCompare(b.reason));
  return groups;
}

export function collectDuplicateItemIds(groups: LocalSigDuplicateGroup[]): Set<string> {
  const ids = new Set<string>();
  for (const g of groups) {
    for (const id of g.itemIds) ids.add(id);
  }
  return ids;
}

/** 카탈로그에 없는 from-drive 파일명 */
export function listFromDriveFilesNotInCatalog(
  diskFiles: string[],
  catalog: LocalSigCatalogEntry[]
): string[] {
  const usedBases = new Set<string>();
  const usedNames = new Set<string>();
  for (const item of catalog) {
    const b = localSigFileBaseKey(item.file || item.imageUrl);
    if (b) usedBases.add(b);
    const n = normalizeLocalSigNameKey(item.name);
    if (n) usedNames.add(n);
  }
  return diskFiles.filter((file) => {
    const base = localSigFileBaseKey(file);
    const nameKey = normalizeLocalSigNameKey(file.replace(/\.[^.]+$/i, ""));
    if (base && usedBases.has(base)) return false;
    if (nameKey && usedNames.has(nameKey)) return false;
    return true;
  });
}

export function buildLocalSigEntryFromFileName(fileName: string, id?: string): LocalSigCatalogEntry {
  const file = fileName.trim();
  const base = file.replace(/\.[^.]+$/i, "");
  const imageUrl = `/images/sigs/from-drive/${encodeURIComponent(file)}`;
  return {
    id: id || `local_add_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: base || file,
    price: 0,
    category: "",
    file,
    imageUrl,
    priceSource: "local",
  };
}
