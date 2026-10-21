import type { AppState, SigItem } from "@/types";
import {
  DEFAULT_ONE_SHOT_SIG_BUNDLED_IMAGE,
  isDedicatedOneShotSigImageUrl,
  normalizeSigImageUrlStored,
  isLegacyRomanizedFlatSigPath,
  resolveSigBundledFromDriveByName,
  resolveSigOverlayCardImageUrl,
} from "@/lib/constants";
import { repairDiskUploadSigImagePath } from "@/lib/sig-image-mode";
import { buildOneShotFromSelected, resolveOneShotDisplayPrice } from "@/lib/sig-one-shot-price";
import {
  pickRandomManualSigDrafts,
  pickRandomManualSigDraftsBySlotBands,
} from "@/lib/manual-sig-random";
import { listActiveManualSigPool } from "@/lib/manual-sig-active-pool";
import {
  buildManualSigBroadcastLandPatch,
  bumpManualSigBroadcastNonce,
  defaultManualSigBroadcast,
  mergeManualSigBroadcastIntoOverlaySettings,
  readManualSigBroadcastFromState,
} from "@/lib/manual-sig-broadcast-state";
import {
  MANUAL_SIG_DRAFT_STATE_KEY,
  manualSigDraftsReady,
  normalizeManualBuyerMemberIds,
  normalizeManualSaleModes,
  normalizeManualSigDraftPersist,
  normalizeManualSigSaleMode,
  parseManualSigDraftRows,
  readManualSigPickCountFromOverlaySettings,
  readManualSigSlotPriceBandsFromOverlaySettings,
  MAX_MANUAL_SIG_PICK_COUNT,
  DEFAULT_MANUAL_SIG_PICK_COUNT,
  clampManualSigPickCount,
  type ManualSigDraft,
  type ManualSigDraftPersist,
  type ManualSigSaleMode,
} from "@/lib/manual-sig-workbench";
import {
  canonicalSigIdFromWheelSliceId,
  findSigInventoryByName,
  findSigInventoryByNameAndPrice,
  hydrateSigItemFromInventory,
  preferPositiveSigPrice,
  ONE_SHOT_SIG_ID,
} from "@/lib/sig-roulette";
import { stripBundledSigPlaceholderItems } from "@/lib/sig-placeholder";
import { resolveMemberDisplayColor } from "@/lib/member-display-color";

const MIN_MANUAL_OVERLAY_SIGS = 2;

export function readManualSigDraftFromState(
  state: AppState | null | undefined
): ManualSigDraftPersist | null {
  const os = state?.overlaySettings;
  if (!os || typeof os !== "object") return null;
  const raw = (os as Record<string, unknown>)[MANUAL_SIG_DRAFT_STATE_KEY];
  const configuredPick = readManualSigPickCount(state);
  const rawDraftLen =
    raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).drafts)
      ? ((raw as Record<string, unknown>).drafts as unknown[]).length
      : 0;
  const pickSlots = clampManualSigPickCount(Math.max(configuredPick, rawDraftLen));
  return normalizeManualSigDraftPersist(raw, pickSlots);
}

function normalizeSigImageCompareKey(url: string): string {
  return normalizeSigImageUrlStored(String(url || "").trim()).toLowerCase();
}

function collectSelectedSigImageKeys(selected: SigItem[]): Set<string> {
  const keys = new Set<string>();
  for (const item of selected) {
    const raw = String(item.imageUrl || "").trim();
    if (!raw) continue;
    keys.add(normalizeSigImageCompareKey(raw));
  }
  return keys;
}

function isSameAsSelectedSigImage(url: string, selected: SigItem[]): boolean {
  const key = normalizeSigImageCompareKey(url);
  if (!key) return false;
  return collectSelectedSigImageKeys(selected).has(key);
}

/** 저장 경로 — 초안·인벤 한방 전용만, 당첨 시그 GIF와 같으면 번들 `한방시그.gif` */
export function resolveManualOneShotStoredImageUrl(params: {
  state: AppState | null | undefined;
  selectedSigs?: SigItem[];
}): string {
  const selected = params.selectedSigs || [];
  const draftImage = String(readManualSigDraftFromState(params.state)?.oneShotImageUrl || "").trim();
  if (
    draftImage &&
    isDedicatedOneShotSigImageUrl(draftImage) &&
    !isSameAsSelectedSigImage(draftImage, selected)
  ) {
    return draftImage;
  }
  const inv = params.state?.sigInventory || [];
  const oneShotItem = inv.find((item) => item.id === ONE_SHOT_SIG_ID);
  const fromInv = String(oneShotItem?.imageUrl || "").trim();
  if (
    fromInv &&
    isDedicatedOneShotSigImageUrl(fromInv) &&
    !isSameAsSelectedSigImage(fromInv, selected)
  ) {
    return fromInv;
  }
  return DEFAULT_ONE_SHOT_SIG_BUNDLED_IMAGE;
}

/** 수동·한방 OBS 카드용 — `resolveManualOneShotStoredImageUrl` → OBS 절대 URL */
export function resolveManualOneShotOverlayImageUrl(params: {
  state: AppState | null | undefined;
  selectedSigs: SigItem[];
  userId: string;
  oneShotName?: string;
}): string {
  const label = String(params.oneShotName || "한방 시그").trim() || "한방 시그";
  const stored = resolveManualOneShotStoredImageUrl({
    state: params.state,
    selectedSigs: params.selectedSigs,
  });
  return resolveSigOverlayCardImageUrl(label, stored, params.userId);
}

/** 리롤·LANDED 시 `sig_one_shot` 행 이미지를 한방 전용 GIF로 맞춤 */
export function syncOneShotInventoryImage(
  inventory: SigItem[] | undefined | null,
  imageUrl: string = DEFAULT_ONE_SHOT_SIG_BUNDLED_IMAGE
): SigItem[] {
  const url = String(imageUrl || DEFAULT_ONE_SHOT_SIG_BUNDLED_IMAGE).trim() || DEFAULT_ONE_SHOT_SIG_BUNDLED_IMAGE;
  const list = Array.isArray(inventory) ? inventory : [];
  const hasRow = list.some((row) => row?.id === ONE_SHOT_SIG_ID);
  if (!hasRow) return list;
  return list.map((row) => (row.id === ONE_SHOT_SIG_ID ? { ...row, imageUrl: url } : row));
}

/** 수동 판매완료 체크 → 서버·OBS 반영 */
export function buildManualSigSoldPersistState(
  base: AppState,
  opts: {
    sigSoldFlags: boolean[];
    oneShotMarkSold: boolean;
    sigSaleModes?: ManualSigSaleMode[];
    sigBuyerMemberIds?: (string | null)[];
    persistDrafts?: ManualSigDraftPersist;
    userId?: string;
  }
): AppState {
  const now = Date.now();
  const userId = String(opts.userId || "").trim() || "finalent";
  const prevOverlaySettings =
    base.overlaySettings && typeof base.overlaySettings === "object"
      ? (base.overlaySettings as Record<string, unknown>)
      : {};
  const existingDraft = readManualSigDraftFromState(base);
  const flagCount = Math.max(
    opts.sigSoldFlags.length,
    existingDraft?.drafts?.length || 0,
    DEFAULT_MANUAL_SIG_PICK_COUNT
  );
  const n = clampManualSigPickCount(flagCount);
  const sigSoldFlags = opts.sigSoldFlags;
  const sigSaleModes = normalizeManualSaleModes(
    opts.sigSaleModes ?? existingDraft?.sigSaleModes,
    n
  );
  const sigBuyerMemberIds = normalizeManualBuyerMemberIds(
    opts.sigBuyerMemberIds ?? existingDraft?.sigBuyerMemberIds,
    sigSoldFlags,
    n
  );
  const draftPayload: ManualSigDraftPersist = opts.persistDrafts ?? {
    inputMode: existingDraft?.inputMode ?? "inventory",
    drafts: existingDraft?.drafts ?? [],
    oneShotName: existingDraft?.oneShotName ?? "한방 시그",
    oneShotPriceInput: existingDraft?.oneShotPriceInput ?? "",
    oneShotImageUrl:
      String(existingDraft?.oneShotImageUrl || "").trim() || DEFAULT_ONE_SHOT_SIG_BUNDLED_IMAGE,
    sigSoldFlags,
    oneShotMarkSold: opts.oneShotMarkSold,
    sigSaleModes,
    sigBuyerMemberIds,
  };
  const tempState: AppState = {
    ...base,
    overlaySettings: {
      ...prevOverlaySettings,
      [MANUAL_SIG_DRAFT_STATE_KEY]: draftPayload,
    },
  };
  const selected = resolveManualOverlaySelectedSigs(tempState, userId);
  const oneShotDisplay = resolveManualOneShotDisplayFromState(tempState, selected, userId);
  const prevBroadcast = readManualSigBroadcastFromState(base) ?? defaultManualSigBroadcast();
  const oneShotResult = oneShotDisplay ?? prevBroadcast.oneShotResult ?? null;
  const nextBroadcast = bumpManualSigBroadcastNonce({
    ...prevBroadcast,
    ...(oneShotResult ? { oneShotResult } : {}),
    ...(selected.length >= MIN_MANUAL_OVERLAY_SIGS ? { selectedSigs: selected, phase: "LANDED" as const } : {}),
  });
  return {
    ...base,
    overlaySettings: mergeManualSigBroadcastIntoOverlaySettings(
      {
        ...base,
        overlaySettings: {
          ...prevOverlaySettings,
          [MANUAL_SIG_DRAFT_STATE_KEY]: draftPayload,
        } as AppState["overlaySettings"],
      },
      nextBroadcast
    ),
    updatedAt: now,
  };
}

function normalizeManualSigNameKey(raw: string): string {
  return String(raw || "").trim().toLowerCase().replace(/\s+/g, "");
}

/**
 * 당첨 카드 ↔ 수동 초안 행 매칭 — 배열 인덱스가 다를 수 있음(리롤·LANDED 순서 불일치).
 * `sourceSigId` 우선, 없으면 이름·가격.
 */
export function resolveManualDraftRowForSigItem(
  item: Pick<SigItem, "id" | "name" | "price">,
  drafts: ManualSigDraft[] | undefined | null
): ManualSigDraft | undefined {
  if (!Array.isArray(drafts) || drafts.length === 0) return undefined;
  const parsed = parseManualSigDraftRows(drafts);
  const canon = canonicalSigIdFromWheelSliceId(item.id);
  const nk = normalizeManualSigNameKey(item.name);
  const price = Math.floor(Number(item.price || 0));
  for (let i = 0; i < drafts.length; i++) {
    const draft = drafts[i];
    const row = parsed[i];
    if (!row?.name) continue;
    const sourceId = String(draft?.sourceSigId || "").trim();
    if (sourceId && (sourceId === item.id || canonicalSigIdFromWheelSliceId(sourceId) === canon)) {
      return draft;
    }
    if (
      normalizeManualSigNameKey(row.name) === nk &&
      Math.floor(Number(row.price || 0)) === price
    ) {
      return draft;
    }
  }
  return undefined;
}

/** 수동 초안 행(폼 idx) → OBS 당첨 카드 */
export function findDisplaySigForManualDraftRow(
  draftRow: ManualSigDraft | undefined,
  parsedRow: { name: string; price: number } | undefined,
  displayList: SigItem[]
): SigItem | undefined {
  if (!displayList.length) return undefined;
  const sourceId = String(draftRow?.sourceSigId || "").trim();
  if (sourceId) {
    const canon = canonicalSigIdFromWheelSliceId(sourceId);
    const hit = displayList.find(
      (s) => s.id === sourceId || canonicalSigIdFromWheelSliceId(s.id) === canon
    );
    if (hit) return hit;
  }
  if (!parsedRow?.name) return undefined;
  const nk = normalizeManualSigNameKey(parsedRow.name);
  const price = Math.floor(Number(parsedRow.price || 0));
  const nameHits = displayList.filter((s) => normalizeManualSigNameKey(s.name) === nk);
  if (price > 0) {
    const exact = nameHits.find((s) => Math.floor(Number(s.price || 0)) === price);
    if (exact) return exact;
  }
  return nameHits[0];
}

function hasUsableManualSigImageUrl(url: string | undefined | null): boolean {
  const s = String(url || "").trim();
  if (!s || s.toLowerCase().includes("dummy-sig.svg")) return false;
  if (/^\/images\/sig\//i.test(s)) return false;
  if (isLegacyRomanizedFlatSigPath(s)) return false;
  return true;
}

/**
 * 서버 selectedSigs.imageUrl 이 비었을 때 초안(draft) 기반 URL로 보강 — dc4b569 이후 OBS 회귀 대응.
 */
export function patchManualOverlaySigImagesFromDraft(
  items: SigItem[],
  drafts: ManualSigDraft[] | undefined | null,
  inventory: SigItem[] | undefined,
  userId: string
): SigItem[] {
  if (!items.length) return items;
  if (!Array.isArray(drafts) || !manualSigDraftsReady(drafts, drafts.length)) return items;
  if (!items.some((i) => !hasUsableManualSigImageUrl(i.imageUrl))) return items;
  const fromDraft = buildManualSigItemsFromDrafts(drafts, inventory, userId);
  return items.map((item) => {
    if (hasUsableManualSigImageUrl(item.imageUrl)) return item;
    const canon = canonicalSigIdFromWheelSliceId(item.id);
    const nk = normalizeManualSigNameKey(item.name);
    const price = Math.floor(Number(item.price || 0));
    const hit =
      fromDraft.find(
        (d) => d.id === item.id || canonicalSigIdFromWheelSliceId(d.id) === canon
      ) ||
      fromDraft.find(
        (d) =>
          normalizeManualSigNameKey(d.name) === nk &&
          Math.floor(Number(d.price || 0)) === price
      );
    if (hit && hasUsableManualSigImageUrl(hit.imageUrl)) {
      return { ...item, imageUrl: hit.imageUrl };
    }
    const draftRow = resolveManualDraftRowForSigItem(item, drafts);
    const forced = resolveManualSigStoredImageUrl({
      name: item.name,
      price: Math.max(0, Math.floor(Number(item.price || 0))),
      itemImageUrl: item.imageUrl,
      sourceSigId: draftRow?.sourceSigId,
      draftImageUrl: draftRow?.imageUrl,
      inventory,
      userId,
    });
    return forced ? { ...item, imageUrl: forced } : item;
  });
}

/**
 * 개별 시그 카드 저장 URL — 한방시그와 달리 인벤·초안 업로드를 최우선(서버 selectedSigs 레거시 URL 무시).
 */
function resolveManualSigStoredImageUrl(params: {
  name: string;
  price: number;
  itemImageUrl?: string;
  sourceSigId?: string;
  draftImageUrl?: string;
  inventory?: SigItem[];
  userId?: string;
}): string {
  const displayName = String(params.name || "").trim();
  const candidates: string[] = [];
  const add = (raw: string | undefined | null) => {
    const repaired = repairDiskUploadSigImagePath(String(raw || "").trim(), params.userId);
    const s = String(repaired || "").trim();
    if (!s || candidates.includes(s)) return;
    if (!hasUsableManualSigImageUrl(s)) return;
    candidates.push(s);
  };
  const sid = String(params.sourceSigId || "").trim();
  /** 인벤 등록 URL이 정본 — 초안·서버 selectedSigs보다 우선(한방은 고정 from-drive) */
  if (sid && params.inventory?.length) {
    add(params.inventory.find((x) => String(x.id || "").trim() === sid)?.imageUrl);
  }
  if (params.inventory?.length) {
    add(findSigInventoryByName(params.inventory, displayName)?.imageUrl);
    add(findSigInventoryByNameAndPrice(params.inventory, displayName, params.price)?.imageUrl);
  }
  add(params.draftImageUrl);
  add(params.itemImageUrl);
  const upload = candidates.find((u) => u.startsWith("/uploads/sigs/"));
  if (upload) return upload;
  const external = candidates.find((u) => /^https?:\/\//i.test(u));
  if (external) return external;
  const fromDrive = candidates.find((u) => u.includes("/from-drive/"));
  if (fromDrive) return fromDrive;
  const bundled = candidates.find(
    (u) => u.startsWith("/images/sigs/") && !isLegacyRomanizedFlatSigPath(u)
  );
  if (bundled) return bundled;
  const byName = displayName ? resolveSigBundledFromDriveByName(displayName) : "";
  if (byName) return byName;
  return candidates[0] || "";
}

/** LANDED·리롤 저장 시 초안 행에 인벤 imageUrl 동기화 — OBS pick이 인벤과 동일 URL 사용 */
export function enrichManualDraftsWithInventoryImageUrls(
  draft: ManualSigDraftPersist,
  inventory: SigItem[] | undefined,
  userId?: string
): ManualSigDraftPersist {
  const rows = Array.isArray(draft.drafts) ? draft.drafts : [];
  if (!rows.length) return draft;
  const parsed = parseManualSigDraftRows(rows);
  const drafts = rows.map((row, idx) => {
    const displayName = parsed[idx]?.name || row.name;
    const sourceSigId = String(row.sourceSigId || "").trim();
    const fromInv =
      (sourceSigId && inventory?.find((x) => String(x.id || "").trim() === sourceSigId)) ||
      findSigInventoryByNameAndPrice(inventory || [], displayName, parsed[idx]?.price || 0) ||
      findSigInventoryByName(inventory || [], displayName);
    const price = preferPositiveSigPrice(parsed[idx]?.price, fromInv?.price);
    const url = resolveManualSigStoredImageUrl({
      name: displayName,
      price,
      sourceSigId: row.sourceSigId,
      draftImageUrl: row.imageUrl,
      inventory,
      userId,
    });
    const next = url ? { ...row, imageUrl: url } : row;
    if (price > 0 && preferPositiveSigPrice(parsed[idx]?.price) <= 0) {
      return { ...next, priceInput: String(price) };
    }
    return next;
  });
  return { ...draft, drafts };
}

/** 업로드 경로·from-drive·인벤 URL 중 OBS에 가장 잘 먹는 경로 선택 */
function pickBestManualSigStoredImageUrl(
  urls: Array<string | undefined | null>,
  sigName?: string
): string {
  const list = urls
    .map((u) => String(u || "").trim())
    .filter(
      (u) => Boolean(u) && !isLegacyRomanizedFlatSigPath(u) && !/^\/images\/sig\//i.test(u)
    );
  const upload = list.find((u) => u.startsWith("/uploads/sigs/"));
  if (upload) return upload;
  const fromDrive = list.find((u) => u.includes("/from-drive/"));
  if (fromDrive) return fromDrive;
  const bundled = list.find(
    (u) => u.startsWith("/images/sigs/") && !isLegacyRomanizedFlatSigPath(u)
  );
  if (bundled) return bundled;
  const byName = sigName ? resolveSigBundledFromDriveByName(sigName) : "";
  if (byName) return byName;
  return list[0] || "";
}

/** OBS `memberId` 쿼리로 당첨 목록이 비지 않게 — 인벤 멤버 id는 덮어쓰지 않음 */
export function hydrateManualOverlaySigItem(
  item: SigItem,
  inventory: SigItem[] | undefined,
  userId?: string,
  draftRow?: Pick<ManualSigDraft, "imageUrl" | "sourceSigId">
): SigItem {
  const h = hydrateSigItemFromInventory(item, inventory, userId);
  const sourceSigId = String(draftRow?.sourceSigId || "").trim();
  const fromSource =
    sourceSigId && inventory?.length
      ? inventory.find((x) => String(x.id || "").trim() === sourceSigId)?.imageUrl
      : "";
  const fromNamePrice = inventory?.length
    ? findSigInventoryByNameAndPrice(inventory, item.name, item.price)?.imageUrl
    : "";
  const displayName = String(item.name || h.name || "").trim() || h.name;
  const fromNameRow = inventory?.length ? findSigInventoryByName(inventory, displayName) : undefined;
  const fromName = fromNameRow?.imageUrl || "";
  const price = preferPositiveSigPrice(item.price, h.price, fromNameRow?.price);
  const imageUrl = resolveManualSigStoredImageUrl({
    name: displayName,
    price,
    itemImageUrl: pickBestManualSigStoredImageUrl(
      [fromSource, fromName, fromNamePrice, h.imageUrl, draftRow?.imageUrl, item.imageUrl],
      displayName
    ),
    sourceSigId,
    draftImageUrl: draftRow?.imageUrl,
    inventory,
    userId,
  });
  return { ...h, name: displayName, memberId: "", imageUrl, price };
}

export function buildManualSigItemsFromDrafts(
  drafts: ReturnType<typeof pickRandomManualSigDrafts>,
  inventory: SigItem[] | undefined,
  userId: string
): SigItem[] {
  if (!drafts) return [];
  const rows = parseManualSigDraftRows(drafts);
  return rows.map((row, idx) => {
    const sourceSigId = String(drafts[idx]?.sourceSigId || "").trim();
    const safeName =
      row.name.replace(/\s+/g, "_").replace(/[^\w가-힣-]/g, "").slice(0, 24) || `sig_${idx + 1}`;
    const base: SigItem = {
      id: sourceSigId || `manual_${safeName}`,
      name: row.name,
      price: row.price,
      imageUrl: row.imageUrl,
      memberId: "",
      maxCount: 1,
      soldCount: 0,
      isRolling: true,
      isActive: true,
    };
    return hydrateManualOverlaySigItem(base, inventory, userId, drafts[idx]);
  });
}

/** 수동 리롤 — 풀에 2개 이상이면 설정 당첨 수(최대 36)까지 랜덤 */
export const MANUAL_REROLL_MIN_POOL = MIN_MANUAL_OVERLAY_SIGS;
export function readManualSigPickCount(state: AppState | null | undefined): number {
  const os =
    state?.overlaySettings && typeof state.overlaySettings === "object"
      ? (state.overlaySettings as Record<string, unknown>)
      : undefined;
  return readManualSigPickCountFromOverlaySettings(os);
}

/** @deprecated use MAX_MANUAL_SIG_PICK_COUNT */
export const MANUAL_REROLL_MAX_PICK = MAX_MANUAL_SIG_PICK_COUNT;

export function soldFlagsWithOneShotCascade(
  flags: boolean[],
  oneShotMarkSold: boolean,
  slotCount = DEFAULT_MANUAL_SIG_PICK_COUNT
): boolean[] {
  const next = [...flags];
  while (next.length < slotCount) next.push(false);
  if (oneShotMarkSold) return Array.from({ length: slotCount }, () => true);
  return next.slice(0, slotCount);
}

export function soldSetForFullManualRound(
  selected: SigItem[],
  flags: boolean[],
  oneShotMarkSold: boolean
): Set<string> {
  const cascade = soldFlagsWithOneShotCascade(flags, oneShotMarkSold);
  if (oneShotMarkSold && selected.length >= MIN_MANUAL_OVERLAY_SIGS) {
    const all = new Set<string>();
    selected.forEach((row) => {
      all.add(row.id);
      all.add(canonicalSigIdFromWheelSliceId(row.id));
    });
    return all;
  }
  const out = new Set<string>();
  selected.forEach((row, idx) => {
    if (!cascade[idx]) return;
    out.add(row.id);
    out.add(canonicalSigIdFromWheelSliceId(row.id));
  });
  return out;
}

/**
 * 초안 슬롯(draftIdx) 체크 → 인벤 재고 id 집합.
 * `soldSetForFullManualRound`의 display 인덱스 매칭과 달리 draft·display 순서 불일치에도 동작.
 */
export function resolveManualSoldInventoryTargetIds(
  state: AppState | null | undefined,
  selected: SigItem[],
  userId: string,
  flags: boolean[],
  oneShotMarkSold: boolean
): Set<string> {
  const out = new Set<string>();
  const draft = readManualSigDraftFromState(state);
  const cascade = soldFlagsWithOneShotCascade(flags, oneShotMarkSold);
  const normalizeNameKey = (raw: string) =>
    String(raw || "").trim().toLowerCase().replace(/\s+/g, "");

  if (oneShotMarkSold && selected.length >= MIN_MANUAL_OVERLAY_SIGS) {
    for (const row of selected) {
      const canon = canonicalSigIdFromWheelSliceId(String(row.id || ""));
      if (canon) out.add(canon);
      const nk = normalizeNameKey(row.name);
      const price = Math.floor(Number(row.price || 0));
      for (const inv of state?.sigInventory || []) {
        if (!inv || inv.id === ONE_SHOT_SIG_ID) continue;
        if (
          inv.id === row.id ||
          canonicalSigIdFromWheelSliceId(inv.id) === canon ||
          (normalizeNameKey(inv.name) === nk && Math.floor(Number(inv.price || 0)) === price)
        ) {
          out.add(inv.id);
          out.add(canonicalSigIdFromWheelSliceId(inv.id));
        }
      }
    }
    out.add(ONE_SHOT_SIG_ID);
    out.add(canonicalSigIdFromWheelSliceId(ONE_SHOT_SIG_ID));
    return out;
  }

  const items = selected.length >= MIN_MANUAL_OVERLAY_SIGS ? selected : [];
  const draftItems =
    items.length >= MIN_MANUAL_OVERLAY_SIGS
      ? items
      : draft
        ? buildManualSigItemsFromDrafts(draft.drafts, state?.sigInventory, userId)
        : [];
  const list = draftItems.length >= MIN_MANUAL_OVERLAY_SIGS ? draftItems : items;
  const parsedRows = parseManualSigDraftRows(draft?.drafts || []);

  cascade.forEach((sold, draftIdx) => {
    if (!sold) return;
    const draftRow = draft?.drafts?.[draftIdx];
    const parsed = parsedRows[draftIdx];
    const item = findDisplaySigForManualDraftRow(draftRow, parsed, list);
    if (item) {
      const canon = canonicalSigIdFromWheelSliceId(item.id);
      if (canon) out.add(canon);
      const nk = normalizeNameKey(item.name);
      const price = Math.floor(Number(item.price || 0));
      for (const inv of state?.sigInventory || []) {
        if (!inv || inv.id === ONE_SHOT_SIG_ID) continue;
        if (
          inv.id === item.id ||
          canonicalSigIdFromWheelSliceId(inv.id) === canon ||
          (normalizeNameKey(inv.name) === nk && Math.floor(Number(inv.price || 0)) === price)
        ) {
          out.add(inv.id);
          out.add(canonicalSigIdFromWheelSliceId(inv.id));
        }
      }
    }
    const sourceSid = String(draftRow?.sourceSigId || "").trim();
    if (sourceSid) {
      out.add(sourceSid);
      out.add(canonicalSigIdFromWheelSliceId(sourceSid));
    }
  });

  /** 초안 없을 때(구 테스트·레거시): display 순서와 flags 인덱스 정렬 */
  if (out.size === 0 && cascade.some(Boolean)) {
    const preview = soldSetForFullManualRound(selected, flags, oneShotMarkSold);
    for (const id of preview) {
      out.add(id);
      out.add(canonicalSigIdFromWheelSliceId(id));
    }
    for (const inv of state?.sigInventory || []) {
      const key = canonicalSigIdFromWheelSliceId(String(inv.id || ""));
      if (preview.has(inv.id) || preview.has(key)) {
        out.add(inv.id);
        out.add(key);
      }
    }
  }

  return out;
}

export function collectSoldSigIdsForFinish(
  selected: SigItem[],
  soldIdSet: Set<string>
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const sig of selected) {
    const canon = canonicalSigIdFromWheelSliceId(String(sig.id || ""));
    if (!soldIdSet.has(sig.id) && !soldIdSet.has(canon)) continue;
    const key = canon || sig.id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/** 체크된 시그·한방 → OBS 판매 플래그 반영 (+ 선택 시 라운드 LANDED 유지) */
export function buildManualSigSalesConfirmState(
  base: AppState,
  opts: {
    selected: SigItem[];
    sigSoldFlags: boolean[];
    oneShotMarkSold: boolean;
    sigSaleModes?: ManualSigSaleMode[];
    sigBuyerMemberIds?: (string | null)[];
    userId?: string;
    /** 재고 +1은 이번에 새로 true 된 슬롯만 (이중 차감 방지) */
    previousSoldFlags?: boolean[];
    previousOneShotMarkSold?: boolean;
    /** false면 phase LANDED — 나머지 시그 개별 확정 가능 */
    closeRound?: boolean;
  }
): AppState {
  const cascadeFlags = soldFlagsWithOneShotCascade(opts.sigSoldFlags, opts.oneShotMarkSold);
  const now = Date.now();
  const draftPersist = buildManualSigSoldPersistState(base, {
    sigSoldFlags: cascadeFlags,
    oneShotMarkSold: opts.oneShotMarkSold,
    sigSaleModes: opts.sigSaleModes,
    sigBuyerMemberIds: opts.sigBuyerMemberIds,
    userId: opts.userId,
  });
  const closeRound = opts.closeRound !== false;
  const prevBroadcast = readManualSigBroadcastFromState(draftPersist) ?? defaultManualSigBroadcast();
  const nextBroadcast = bumpManualSigBroadcastNonce({
    ...prevBroadcast,
    phase: closeRound ? "CONFIRMED" : "LANDED",
    ...(closeRound ? { lastFinishedAt: now } : {}),
  });
  return {
    ...draftPersist,
    sigInventory: base.sigInventory || [],
    overlaySettings: mergeManualSigBroadcastIntoOverlaySettings(draftPersist, nextBroadcast),
    updatedAt: now,
  };
}

/** 수동 OBS — 서버 LANDED 당첨 + 초안 폴백(리롤 직후 pick 지연 대비) */
export function resolveManualOverlaySelectedSigs(
  state: AppState | null | undefined,
  userId: string
): SigItem[] {
  if (!state) return [];
  const broadcast = readManualSigBroadcastFromState(state);
  const raw = (
    Array.isArray(broadcast?.selectedSigs) && broadcast!.selectedSigs.length > 0
      ? broadcast!.selectedSigs
      : []
  ) as SigItem[];
  const inv = state.sigInventory || [];
  const pickCount = readManualSigPickCount(state);
  const draftRaw = readManualSigDraftFromState(state);
  const draft = draftRaw
    ? enrichManualDraftsWithInventoryImageUrls(draftRaw, inv, userId)
    : draftRaw;
  const draftRows = Array.isArray(draft?.drafts) ? draft!.drafts : [];
  const draftReady = Boolean(draft && manualSigDraftsReady(draft.drafts, pickCount));
  const draftItems = draftReady
    ? stripBundledSigPlaceholderItems(buildManualSigItemsFromDrafts(draft!.drafts, inv, userId))
    : [];
  const phase = String(broadcast?.phase || "").trim();
  const terminalPhase = phase === "LANDED" || phase === "CONFIRMED";
  const serverPickCount = raw.length;
  const serverPicksReady = terminalPhase && serverPickCount >= MIN_MANUAL_OVERLAY_SIGS;
  /** IDLE 리셋 직후 옛 초안을 OBS에 띄우지 않음 */
  const allowDraftPrimary =
    draftReady &&
    draftItems.length >= MIN_MANUAL_OVERLAY_SIGS &&
    (terminalPhase || serverPickCount >= MIN_MANUAL_OVERLAY_SIGS);
  const hydrateServerPicks = () =>
    stripBundledSigPlaceholderItems(
      raw.map((s) =>
        hydrateManualOverlaySigItem(
          s,
          inv,
          userId,
          resolveManualDraftRowForSigItem(s, draftRows)
        )
      )
    );
  /** LANDED·서버 당첨이 있으면 pick 정본 우선(리롤 직후 OBS 동기화). 없으면 초안 폴백 */
  let items: SigItem[];
  if (serverPicksReady) {
    items = hydrateServerPicks();
    if (draft && draft.drafts?.length) {
      items = patchManualOverlaySigImagesFromDraft(items, draft.drafts, inv, userId);
    }
  } else if (allowDraftPrimary) {
    items = draftItems;
  } else {
    items = hydrateServerPicks();
    if (
      items.length < MIN_MANUAL_OVERLAY_SIGS &&
      allowDraftPrimary &&
      draft
    ) {
      items = stripBundledSigPlaceholderItems(
        buildManualSigItemsFromDrafts(draft.drafts, inv, userId)
      );
    } else if (items.length >= MIN_MANUAL_OVERLAY_SIGS && draft && draft.drafts?.length) {
      items = patchManualOverlaySigImagesFromDraft(items, draft.drafts, inv, userId);
    }
  }
  return items.slice(0, pickCount);
}

export type ManualPanelSaleRow = {
  draftIdx: number;
  name: string;
  price: number;
  imageUrl: string;
};

/** 관리자 그리드·합계 — 인벤에서 보강한 이미지·가격 */
export function buildManualPanelSaleRows(
  state: AppState | null | undefined,
  userId: string
): ManualPanelSaleRow[] {
  const pickCount = readManualSigPickCount(state);
  const displaySigs = resolveManualOverlaySelectedSigs(state, userId);
  const draft = readManualSigDraftFromState(state);
  const parsed = parseManualSigDraftRows(draft?.drafts || []);
  const inv = state?.sigInventory || [];
  const rows: ManualPanelSaleRow[] = [];
  for (let i = 0; i < pickCount; i++) {
    const parsedRow = parsed[i];
    const draftRow = draft?.drafts?.[i];
    const matched =
      findDisplaySigForManualDraftRow(draftRow, parsedRow, displaySigs) || displaySigs[i];
    const hydrated = matched
      ? hydrateManualOverlaySigItem(matched, inv, userId, draftRow)
      : parsedRow?.name
        ? hydrateManualOverlaySigItem(
            {
              id: String(draftRow?.sourceSigId || `manual_slot_${i}`),
              name: parsedRow.name,
              price: parsedRow.price,
              imageUrl: String(draftRow?.imageUrl || parsedRow.imageUrl || ""),
              memberId: "",
              maxCount: 1,
              soldCount: 0,
              isRolling: true,
              isActive: true,
            },
            inv,
            userId,
            draftRow
          )
        : null;
    const name = String(hydrated?.name || parsedRow?.name || "").trim();
    if (!name) continue;
    rows.push({
      draftIdx: i,
      name,
      /** 칸별 수동 가격(초안)을 인벤 기본가보다 우선 */
      price: preferPositiveSigPrice(parsedRow?.price, hydrated?.price),
      imageUrl: String(hydrated?.imageUrl || draftRow?.imageUrl || parsedRow?.imageUrl || "").trim(),
    });
  }
  return rows;
}

/** 판매 확정·체크에 따라 한방 표시 금액(당첨 합계 − 판매분) */
export function resolveManualOneShotDisplayFromState(
  state: AppState | null | undefined,
  selected: SigItem[],
  userId: string
): { id: string; name: string; price: number } | null {
  if (selected.length < MIN_MANUAL_OVERLAY_SIGS) return null;
  const invOneShot = (state?.sigInventory || []).find((x) => x.id === ONE_SHOT_SIG_ID);
  /** 인벤「OBS 표시」체크 해제 시 오버레이에서 한방 카드 숨김 */
  if (invOneShot && invOneShot.isActive === false) return null;
  const draft = readManualSigDraftFromState(state);
  const soldIdSet = buildManualOverlaySoldOverrideSet(state, selected, userId);
  const storedOneShot = readManualSigBroadcastFromState(state)?.oneShotResult;
  const fallbackName =
    String(draft?.oneShotName || "").trim() ||
    String(invOneShot?.name || "").trim() ||
    storedOneShot?.name;
  return resolveOneShotDisplayPrice({
    selected: selected.map((s) => ({
      id: s.id,
      price: Math.max(0, Math.floor(Number(s.price || 0))),
    })),
    soldIdSet,
    manualPriceInput: draft?.oneShotPriceInput,
    fallbackName,
  });
}

/** 관리자 「판매완료」체크 → OBS 스탬프 (localStorage 없음) */
export function buildManualOverlaySoldOverrideSet(
  state: AppState | null | undefined,
  selected: SigItem[],
  userId: string
): Set<string> {
  const next = new Set<string>();
  const draft = readManualSigDraftFromState(state);
  if (!draft) return next;
  const flags = Array.isArray(draft.sigSoldFlags) ? draft.sigSoldFlags : [];
  const hasFlags = flags.some(Boolean) || Boolean(draft.oneShotMarkSold);
  if (!hasFlags) return next;
  const normalizeNameKey = (raw: string) =>
    String(raw || "").trim().toLowerCase().replace(/\s+/g, "");
  const items = selected.length >= MIN_MANUAL_OVERLAY_SIGS ? selected : [];
  const draftItems =
    items.length >= MIN_MANUAL_OVERLAY_SIGS
      ? items
      : buildManualSigItemsFromDrafts(draft.drafts, state?.sigInventory, userId);
  const list = draftItems.length >= MIN_MANUAL_OVERLAY_SIGS ? draftItems : items;
  const parsedRows = parseManualSigDraftRows(draft.drafts || []);
  flags.forEach((sold, draftIdx) => {
    if (!sold) return;
    const draftRow = draft.drafts?.[draftIdx];
    const parsed = parsedRows[draftIdx];
    const item = findDisplaySigForManualDraftRow(draftRow, parsed, list);
    if (item) {
      next.add(item.id);
      next.add(canonicalSigIdFromWheelSliceId(item.id));
      const nk = normalizeNameKey(item.name);
      const price = Math.floor(Number(item.price || 0));
      for (const row of state?.sigInventory || []) {
        if (!row || row.id === ONE_SHOT_SIG_ID) continue;
        if (
          normalizeNameKey(row.name) === nk &&
          Math.floor(Number(row.price || 0)) === price
        ) {
          next.add(row.id);
          next.add(canonicalSigIdFromWheelSliceId(row.id));
        }
      }
    }
    const sourceSid = String(draftRow?.sourceSigId || "").trim();
    if (sourceSid) {
      next.add(sourceSid);
      next.add(canonicalSigIdFromWheelSliceId(sourceSid));
    }
  });
  if (draft.oneShotMarkSold) {
    next.add(ONE_SHOT_SIG_ID);
    next.add(canonicalSigIdFromWheelSliceId(ONE_SHOT_SIG_ID));
  }
  return next;
}

export type ManualOverlaySoldMeta = {
  buyerMemberId: string | null;
  buyerName: string;
  /** 멤버 고유 표시색 (#rrggbb) */
  buyerColor: string;
  saleMode: ManualSigSaleMode;
};

/**
 * OBS — 시그 id → 구매 멤버·판매 모드.
 * `buildManualOverlaySoldOverrideSet`과 동일 매핑으로 id 키를 채운다.
 */
export function buildManualOverlaySoldMetaBySigId(
  state: AppState | null | undefined,
  selected: SigItem[],
  userId: string
): Map<string, ManualOverlaySoldMeta> {
  const map = new Map<string, ManualOverlaySoldMeta>();
  const draft = readManualSigDraftFromState(state);
  if (!draft) return map;
  const flags = Array.isArray(draft.sigSoldFlags) ? draft.sigSoldFlags : [];
  const modes = normalizeManualSaleModes(draft.sigSaleModes, flags.length || DEFAULT_MANUAL_SIG_PICK_COUNT);
  const buyers = normalizeManualBuyerMemberIds(
    draft.sigBuyerMemberIds,
    flags,
    flags.length || DEFAULT_MANUAL_SIG_PICK_COUNT
  );
  const members = Array.isArray(state?.members) ? state!.members : [];
  const memberIds = members.map((m) => m.id);
  const gaugeColors =
    state?.mealBattle?.memberGaugeColors && typeof state.mealBattle.memberGaugeColors === "object"
      ? state.mealBattle.memberGaugeColors
      : null;
  const nameOf = (id: string | null) => {
    if (!id) return "";
    return String(members.find((m) => m.id === id)?.name || "").trim();
  };
  const colorOf = (id: string | null) =>
    resolveMemberDisplayColor(id, {
      colorByMemberId: gaugeColors,
      memberIds,
    });
  const put = (sigId: string, meta: ManualOverlaySoldMeta) => {
    const id = String(sigId || "").trim();
    if (!id) return;
    map.set(id, meta);
    map.set(canonicalSigIdFromWheelSliceId(id), meta);
  };
  const normalizeNameKey = (raw: string) =>
    String(raw || "").trim().toLowerCase().replace(/\s+/g, "");
  const items = selected.length >= MIN_MANUAL_OVERLAY_SIGS ? selected : [];
  const draftItems =
    items.length >= MIN_MANUAL_OVERLAY_SIGS
      ? items
      : buildManualSigItemsFromDrafts(draft.drafts, state?.sigInventory, userId);
  const list = draftItems.length >= MIN_MANUAL_OVERLAY_SIGS ? draftItems : items;
  const parsedRows = parseManualSigDraftRows(draft.drafts || []);
  flags.forEach((sold, draftIdx) => {
    if (!sold) return;
    const buyerMemberId = buyers[draftIdx] ?? null;
    const meta: ManualOverlaySoldMeta = {
      buyerMemberId,
      buyerName: nameOf(buyerMemberId),
      buyerColor: colorOf(buyerMemberId),
      saleMode: normalizeManualSigSaleMode(modes[draftIdx]),
    };
    const draftRow = draft.drafts?.[draftIdx];
    const parsed = parsedRows[draftIdx];
    const item = findDisplaySigForManualDraftRow(draftRow, parsed, list);
    if (item) {
      put(item.id, meta);
      const nk = normalizeNameKey(item.name);
      const price = Math.floor(Number(item.price || 0));
      for (const row of state?.sigInventory || []) {
        if (!row || row.id === ONE_SHOT_SIG_ID) continue;
        if (
          normalizeNameKey(row.name) === nk &&
          Math.floor(Number(row.price || 0)) === price
        ) {
          put(row.id, meta);
        }
      }
    }
    const sourceSid = String(draftRow?.sourceSigId || "").trim();
    if (sourceSid) put(sourceSid, meta);
  });
  return map;
}

/** 재고에서 N개 랜덤(+칸별 금액대) + 한방 합산 */
export function pickRandomManualSigBundle(
  base: AppState,
  userId: string,
  opts?: { memberFilterId?: string; pickCount?: number }
): { selected: SigItem[]; oneShot: { id: string; name: string; price: number } } | null {
  const pool = listActiveManualSigPool(base.sigInventory, {
    memberFilterId: opts?.memberFilterId,
    sigSalesExcludedIds: base.sigSalesExcludedIds,
    ignoreStock: true,
    ownerUserId: userId,
  });
  const pickCount = clampManualSigPickCount(opts?.pickCount ?? readManualSigPickCount(base));
  const actualPick = Math.min(pickCount, pool.length);
  if (actualPick < MANUAL_REROLL_MIN_POOL) return null;
  const os =
    base.overlaySettings && typeof base.overlaySettings === "object"
      ? (base.overlaySettings as Record<string, unknown>)
      : null;
  const bands = readManualSigSlotPriceBandsFromOverlaySettings(os, actualPick);
  const hasBandFilter = bands.some((b) => b.min > 0 || b.max > 0);
  const drafts = hasBandFilter
    ? pickRandomManualSigDraftsBySlotBands(pool, bands.slice(0, actualPick))
    : pickRandomManualSigDrafts(pool, actualPick);
  if (!drafts) return null;
  const selected = buildManualSigItemsFromDrafts(drafts, base.sigInventory, userId);
  const oneShot = buildOneShotFromSelected(selected);
  if (!oneShot || selected.length < MANUAL_REROLL_MIN_POOL) return null;
  return { selected, oneShot };
}

export function buildManualSigBroadcastState(
  base: AppState,
  selected: SigItem[],
  oneShot: { id: string; name: string; price: number },
  opts?: { persistDrafts?: ManualSigDraftPersist }
): AppState {
  const now = Date.now();
  const prevOverlaySettings =
    base.overlaySettings && typeof base.overlaySettings === "object"
      ? (base.overlaySettings as Record<string, unknown>)
      : {};
  const oneShotImage =
    String(opts?.persistDrafts?.oneShotImageUrl || "").trim() || DEFAULT_ONE_SHOT_SIG_BUNDLED_IMAGE;
  const broadcast = buildManualSigBroadcastLandPatch(base, selected, oneShot);
  const overlaySettings = mergeManualSigBroadcastIntoOverlaySettings(base, broadcast);
  if (opts?.persistDrafts) {
    (overlaySettings as Record<string, unknown>)[MANUAL_SIG_DRAFT_STATE_KEY] = {
      ...opts.persistDrafts,
      oneShotImageUrl: oneShotImage,
    };
  }
  return {
    ...base,
    sigInventory: syncOneShotInventoryImage(base.sigInventory, oneShotImage),
    overlaySettings,
    updatedAt: now,
  };
}
