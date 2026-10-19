import type { SigItem } from "@/types";
import { normalizeSigDedupKeyName } from "@/lib/sig-inventory-dedup";
import { ONE_SHOT_SIG_ID } from "@/lib/sig-roulette";

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
  defaultAlertImageUrl?: string | null
): SigItem[] {
  const sorted = [...(signatures || [])].sort(
    (a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0)
  );
  const out: SigItem[] = [];
  const seenNames = new Set<string>();
  const seenIds = new Set<string>();
  const fallbackImage = resolveToonaAssetUrl(defaultAlertImageUrl, apiBaseUrl);

  for (const row of sorted) {
    const name = String(row.name || "").trim();
    if (!name) continue;
    const nameKey = normalizeSigDedupKeyName(name);
    if (seenNames.has(nameKey)) continue;

    const rawId = String(row.id || "").trim();
    const id = rawId ? `toona_${rawId}` : `toona_${nameKey.slice(0, 40)}_${out.length}`;
    if (seenIds.has(id) || id === ONE_SHOT_SIG_ID) continue;

    const ownImage = resolveToonaAssetUrl(row.imageUrl, apiBaseUrl);
    out.push({
      id,
      name,
      price: Math.max(0, Math.floor(Number(row.triggerAmount) || 0)),
      imageUrl: ownImage || fallbackImage,
      memberId: "",
      maxCount: 1,
      soldCount: 0,
      isActive: row.enabled !== false,
      isRolling: true,
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

  if (mode === "replace") {
    return {
      nextInventory: [...oneShot, ...importedClean],
      added: importedClean.length,
      updated: 0,
    };
  }

  const rest = (current || []).filter((x) => x.id !== ONE_SHOT_SIG_ID);
  const byName = new Map<string, number>();
  rest.forEach((item, idx) => {
    byName.set(normalizeSigDedupKeyName(item.name), idx);
  });

  let added = 0;
  let updated = 0;
  const next = [...rest];

  for (const incoming of importedClean) {
    const key = normalizeSigDedupKeyName(incoming.name);
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
      isRolling: prev.isRolling,
    };
    updated += 1;
  }

  return { nextInventory: [...oneShot, ...next], added, updated };
}
