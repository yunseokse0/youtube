import type { SigMatchPool, SigRollingSettings, SigRollingMetaEntry, SigItem, AppState, SigRollingItem } from "@/types";
import { normalizeSigImageUrlStored, normalizeSigInventory, DEFAULT_SIG_INVENTORY } from "@/lib/constants";
import { ONE_SHOT_SIG_ID, sigMatchesMemberFilter } from "@/lib/sig-roulette";
import { isBundledSigPlaceholderItem } from "@/lib/sig-placeholder";

export function normalizeSigRolling(input: unknown): SigRollingSettings {
  const decodeText = (raw: unknown): string => {
    let out = String(raw ?? "").trim();
    for (let i = 0; i < 4; i++) {
      if (!/%[0-9a-f]{2}/i.test(out)) break;
      try {
        const next = decodeURIComponent(out);
        if (next === out) break;
        out = next;
      } catch {
        break;
      }
    }
    return out;
  };
  const v = input && typeof input === "object" ? (input as Partial<SigRollingSettings>) : {};
  const rawItems: unknown[] = Array.isArray(v.items) ? (v.items as unknown[]) : [];
  const items = rawItems
    .filter((x): x is Record<string, unknown> => Boolean(x && typeof x === "object"))
    .map((x) => ({
      id: String(x.id || `sr_${Math.random().toString(36).slice(2, 10)}`),
      url: normalizeSigImageUrlStored(x.url).trim(),
      label: decodeText(x.label),
    }))
    .filter((x) => x.url);
  const fadeMs = Number.isFinite(v.fadeMs) ? Math.max(180, Math.min(5000, Math.floor(Number(v.fadeMs)))) : 1000;
  const staticHoldMs = Number.isFinite(v.staticHoldMs)
    ? Math.max(1000, Math.min(120_000, Math.floor(Number(v.staticHoldMs))))
    : 5000;
  return { items, fadeMs, staticHoldMs };
}

function normalizeSigRollingMeta(input: unknown): Record<string, SigRollingMetaEntry> {
  const decodeText = (raw: unknown): string => {
    let out = String(raw ?? "").trim();
    for (let i = 0; i < 4; i++) {
      if (!/%[0-9a-f]{2}/i.test(out)) break;
      try {
        const next = decodeURIComponent(out);
        if (next === out) break;
        out = next;
      } catch {
        break;
      }
    }
    return out;
  };
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, SigRollingMetaEntry> = {};
  for (const [rawId, rawEntry] of Object.entries(input as Record<string, unknown>)) {
    const id = String(rawId || "").trim();
    if (!id || !rawEntry || typeof rawEntry !== "object") continue;
    const e = rawEntry as Record<string, unknown>;
    const label = decodeText(e.label);
    const orderNum = Number(e.order);
    const order = Number.isFinite(orderNum) ? Math.max(0, Math.floor(orderNum)) : undefined;
    if (!label && order === undefined) continue;
    out[id] = {};
    if (label) out[id]!.label = label;
    if (order !== undefined) out[id]!.order = order;
  }
  return out;
}

export { normalizeSigRollingMeta };

export function filterSigInventoryForSalesDisplay(
  state: Pick<AppState, "sigInventory" | "sigSalesExcludedIds"> | null | undefined,
  memberFilterId?: string | null
): SigItem[] {
  if (!state) return [];
  const excluded = new Set((state.sigSalesExcludedIds || []).map((x) => String(x)));
  return (state.sigInventory || []).filter(
    (x) =>
      x.id !== ONE_SHOT_SIG_ID &&
      Boolean(x.isActive) &&
      !excluded.has(x.id) &&
      sigMatchesMemberFilter(x, memberFilterId)
  );
}

export function getUnifiedSigRollingItems(
  state: Pick<AppState, "sigInventory" | "sigRolling" | "sigRollingMeta" | "sigSalesExcludedIds"> | null | undefined,
  memberFilterId?: string | null
): SigRollingItem[] {
  if (!state) return [];
  const meta = normalizeSigRollingMeta(state.sigRollingMeta);
  const invRows = filterSigInventoryForSalesDisplay(state, memberFilterId)
    .filter((x) => Boolean(x.isRolling))
    .filter((x) => !isBundledSigPlaceholderItem(x))
    .map((x, idx) => {
      const m = meta[x.id] || {};
      return {
        id: x.id,
        url: normalizeSigImageUrlStored(x.imageUrl).trim(),
        label: (m.label && String(m.label).trim()) || String(x.name || "").trim(),
        order: m.order ?? idx,
        price: Math.max(0, Math.floor(Number(x.price) || 0)),
      };
    })
    .filter((x) => x.url && !String(x.url).toLowerCase().includes("dummy-sig.svg"));
  const invById = new Map((state.sigInventory || []).map((x) => [x.id, x]));
  const legacy = normalizeSigRolling(state.sigRolling).items.filter((x) => {
    if (x.id === ONE_SHOT_SIG_ID) return false;
    if (String(x.url || "").toLowerCase().includes("dummy-sig.svg")) return false;
    if (isBundledSigPlaceholderItem({ id: x.id, imageUrl: x.url })) return false;
    const inv = invById.get(x.id);
    if (inv) return Boolean(inv.isRolling) && !isBundledSigPlaceholderItem(inv);
    return true;
  });
  if (invRows.length === 0) {
    return legacy.map((x) => {
      const inv = invById.get(x.id);
      return {
        ...x,
        price: Math.max(0, Math.floor(Number(inv?.price ?? x.price) || 0)),
      };
    });
  }
  return invRows
    .sort((a, b) => a.order - b.order)
    .map(({ id, url, label, price }) => ({ id, url, label, price }));
}

export function normalizeSigMatchPools(raw: unknown, validMemberIds: Set<string>): SigMatchPool[] {
  if (!Array.isArray(raw)) return [];
  const assigned = new Set<string>();
  const out: SigMatchPool[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const idRaw = (item as Record<string, unknown>).id;
    const id =
      typeof idRaw === "string" && idRaw.trim()
        ? idRaw.trim()
        : `pool_${out.length}_${Math.random().toString(36).slice(2, 6)}`;
    const idsRaw = (item as Record<string, unknown>).memberIds;
    const ids = Array.isArray(idsRaw)
      ? idsRaw.map((x) => String(x)).filter((mid) => mid && validMemberIds.has(mid) && !assigned.has(mid))
      : [];
    if (ids.length < 1) continue;
    for (const mid of ids) assigned.add(mid);
    out.push({ id, memberIds: ids });
  }
  return out;
}

export function normalizeSigMatchParticipantIds(raw: unknown, validMemberIds: Set<string>): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of raw) {
    const id = String(x);
    if (!id || !validMemberIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function normalizeSigMatchDonationLinks(
  raw: unknown,
  validMemberIds: Set<string>
): Record<string, { active: boolean; startedAt?: number }> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, { active: boolean; startedAt?: number }> = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!validMemberIds.has(id)) continue;
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const active = Boolean(o.active);
    const startedRaw = Number(o.startedAt);
    const startedAt = Number.isFinite(startedRaw) ? Math.max(0, Math.floor(startedRaw)) : undefined;
    out[id] = active
      ? { active: true, ...(startedAt !== undefined ? { startedAt } : {}) }
      : { active: false, ...(startedAt !== undefined ? { startedAt } : {}) };
  }
  return out;
}

export function normalizeSigMatch(
  raw: unknown,
  validMemberIds: Set<string>
): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!validMemberIds.has(id)) continue;
    const n = Number(v);
    out[id] = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  }
  return out;
}
