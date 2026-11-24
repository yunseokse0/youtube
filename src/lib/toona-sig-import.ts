import type { SigItem } from "@/types";
import { normalizeSigDedupKeyName } from "@/lib/sig-inventory-dedup";
import { ONE_SHOT_SIG_ID } from "@/lib/sig-roulette";
import { repairMojibakeSigName } from "@/lib/sig-name-repair";

export type ToonaSignatureRow = {
  id?: string;
  name?: string;
  triggerAmount?: number | null;
  imageUrl?: string | null;
  enabled?: boolean;
  sortOrder?: number;
};

export type ToonaSigImportMode = "replace" | "merge";

/** toona 상대 경로 이미지를 절대 URL로 */
export function resolveToonaAssetUrl(imageUrl: string | null | undefined, apiBaseUrl: string): string {
  const raw = String(imageUrl || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw) || raw.startsWith("data:")) return raw;
  const base = String(apiBaseUrl || "")
    .trim()
    .replace(/\/$/, "");
  if (!base) return raw;
  if (raw.startsWith("/")) return `${base}${raw}`;
  return `${base}/${raw}`;
}

export function normalizeToonaApiBaseUrl(raw: string): string | null {
  const s = String(raw || "").trim().replace(/\/$/, "");
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return `${u.origin}${u.pathname.replace(/\/$/, "")}`;
  } catch {
    return null;
  }
}

/**
 * toona 시그 → youtube SigItem.
 * @param defaultAlertImageUrl 스트리머 「기본 이미지」— 시그 imageUrl 비어 있을 때 사용
 */
export function mapToonaSignaturesToSigItems(
  signatures: ToonaSignatureRow[],
  apiBaseUrl: string,
  defaultAlertImageUrl?: string | null,
  options?: { onlyEnabled?: boolean }
): SigItem[] {
  const sorted = [...(signatures || [])].sort(
    (a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0)
  );
  const out: SigItem[] = [];
  const seenNames = new Set<string>();
  const seenIds = new Set<string>();
  const fallbackImage = resolveToonaAssetUrl(defaultAlertImageUrl, apiBaseUrl);

  for (const row of sorted) {
    if (options?.onlyEnabled && row.enabled === false) continue;
    const rawName = String(row.name || "").trim();
    if (!rawName) continue;
    const name = repairMojibakeSigName(rawName);
    const nameKey = normalizeSigDedupKeyName(name);
    if (seenNames.has(nameKey)) continue;

    const rawId = String(row.id || "").trim();
    const id = rawId ? `toona_${rawId}` : `toona_${nameKey.slice(0, 40)}_${out.length}`;
    if (seenIds.has(id) || id === ONE_SHOT_SIG_ID) continue;

    const ownImage = resolveToonaAssetUrl(row.imageUrl, apiBaseUrl);
    const active = row.enabled !== false;
    out.push({
      id,
      name,
      price: Math.max(0, Math.floor(Number(row.triggerAmount) || 0)),
      imageUrl: ownImage || fallbackImage,
      memberId: "",
      maxCount: 1,
      soldCount: 0,
      isActive: active,
      isRolling: active,
    });
    seenNames.add(nameKey);
    seenIds.add(id);
  }

  return out;
}

/** toona GET /api/streamers/:streamKey/meta 의 기본 알림 이미지 */
export async function fetchToonaDefaultAlertImageUrl(
  apiBaseUrl: string,
  streamKey: string,
  headers?: Record<string, string>
): Promise<string> {
  const base = String(apiBaseUrl || "")
    .trim()
    .replace(/\/$/, "");
  const key = String(streamKey || "").trim();
  if (!base || !key) return "";
  try {
    const res = await fetch(`${base}/api/streamers/${encodeURIComponent(key)}/meta`, {
      method: "GET",
      headers: { Accept: "application/json", ...(headers || {}) },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return "";
    const json = (await res.json().catch(() => ({}))) as { defaultAlertImageUrl?: string | null };
    return String(json.defaultAlertImageUrl || "").trim();
  } catch {
    return "";
  }
}

/**
 * toona 시그를 로컬 인벤에 반영.
 * - replace: 한방 시그만 유지하고 toona 목록으로 교체
 * - merge: 이름(공백무시) 같으면 가격·이미지·활성 갱신, 없으면 추가. 판매수·최대수량·멤버는 유지
 */
export function applyToonaSigItemsToInventory(
  current: SigItem[],
  imported: SigItem[],
  mode: ToonaSigImportMode
): { nextInventory: SigItem[]; added: number; updated: number } {
  const oneShot = (current || []).filter((x) => x.id === ONE_SHOT_SIG_ID);
  const importedClean = (imported || []).filter((x) => x.id !== ONE_SHOT_SIG_ID);
  const rest = (current || []).filter((x) => x.id !== ONE_SHOT_SIG_ID);

  if (mode === "replace") {
    // 기존에 매핑되어 있던 memberId, maxCount, soldCount 보존
    const prevByName = new Map<string, SigItem>();
    for (const item of rest) {
      prevByName.set(normalizeSigDedupKeyName(item.name), item);
    }
    const replaced = importedClean.map((incoming) => {
      const prev = prevByName.get(normalizeSigDedupKeyName(incoming.name));
      if (!prev) return incoming;
      return {
        ...incoming,
        memberId: prev.memberId || incoming.memberId,
        maxCount: prev.maxCount ?? incoming.maxCount,
        soldCount: prev.soldCount ?? incoming.soldCount,
      };
    });
    return {
      nextInventory: [...oneShot, ...replaced],
      added: replaced.length,
      updated: 0,
    };
  }

  const byName = new Map<string, number>();
  rest.forEach((item, idx) => {
    byName.set(normalizeSigDedupKeyName(item.name), idx);
  });

  let added = 0;
  let updated = 0;
  const next = [...rest];
  const importedKeys = new Set<string>();

  for (const incoming of importedClean) {
    const key = normalizeSigDedupKeyName(incoming.name);
    importedKeys.add(key);
    const idx = byName.get(key);
    if (idx == null) {
      byName.set(key, next.length);
      next.push(incoming);
      added += 1;
      continue;
    }
    const prev = next[idx];
    next[idx] = {
      ...prev,
      name: incoming.name,
      price: incoming.price,
      imageUrl: incoming.imageUrl || prev.imageUrl,
      isActive: incoming.isActive,
      isRolling: incoming.isActive ? (prev.isRolling !== false) : false,
    };
    updated += 1;
  }

  // 프리셋에 포함되지 않은 기존 toona 시그는 비활성화 처리 (프리셋 동기화 일치)
  for (let i = 0; i < next.length; i++) {
    const item = next[i];
    const key = normalizeSigDedupKeyName(item.name);
    if (!importedKeys.has(key) && (item.id.startsWith("toona_") || (item as any).isToona)) {
      next[i] = {
        ...item,
        isActive: false,
        isRolling: false,
      };
    }
  }

  return { nextInventory: [...oneShot, ...next], added, updated };
}
