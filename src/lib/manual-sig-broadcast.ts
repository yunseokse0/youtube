import type { AppState, SigItem } from "@/types";
import {
  DEFAULT_ONE_SHOT_SIG_BUNDLED_IMAGE,
  isDedicatedOneShotSigImageUrl,
  normalizeSigImageUrlStored,
  resolveSigOverlayCardImageUrl,
} from "@/lib/constants";
import { buildOneShotFromSelected } from "@/lib/sig-one-shot-price";
import { pickRandomManualSigDrafts } from "@/lib/manual-sig-random";
import { listActiveManualSigPool } from "@/lib/manual-sig-active-pool";
import { MANUAL_OVERLAY_SESSION_ID } from "@/lib/sig-sales-manual-round";
import {
  MANUAL_SIG_DRAFT_STATE_KEY,
  manualSigDraftsReady,
  normalizeManualSigDraftPersist,
  parseManualSigDraftRows,
  type ManualSigDraft,
  type ManualSigDraftPersist,
} from "@/lib/manual-sig-workbench";
import {
  canonicalSigIdFromWheelSliceId,
  findSigInventoryByNameAndPrice,
  hydrateSigItemFromInventory,
  ONE_SHOT_SIG_ID,
} from "@/lib/sig-roulette";
import { stripBundledSigPlaceholderItems } from "@/lib/sig-placeholder";

export function readManualSigDraftFromState(
  state: AppState | null | undefined
): ManualSigDraftPersist | null {
  const os = state?.overlaySettings;
  if (!os || typeof os !== "object") return null;
  const raw = (os as Record<string, unknown>)[MANUAL_SIG_DRAFT_STATE_KEY];
  return normalizeManualSigDraftPersist(raw);
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
    persistDrafts?: ManualSigDraftPersist;
  }
): AppState {
  const now = Date.now();
  const prevOverlaySettings =
    base.overlaySettings && typeof base.overlaySettings === "object"
      ? (base.overlaySettings as Record<string, unknown>)
      : {};
  const existingDraft = readManualSigDraftFromState(base);
  const draftPayload: ManualSigDraftPersist = opts.persistDrafts ?? {
    inputMode: existingDraft?.inputMode ?? "inventory",
    drafts: existingDraft?.drafts ?? [],
    oneShotName: existingDraft?.oneShotName ?? "한방 시그",
    oneShotPriceInput: existingDraft?.oneShotPriceInput ?? "",
    oneShotImageUrl:
      String(existingDraft?.oneShotImageUrl || "").trim() || DEFAULT_ONE_SHOT_SIG_BUNDLED_IMAGE,
    sigSoldFlags: opts.sigSoldFlags,
    oneShotMarkSold: opts.oneShotMarkSold,
  };
  return {
    ...base,
    overlaySettings: {
      ...prevOverlaySettings,
      [MANUAL_SIG_DRAFT_STATE_KEY]: draftPayload,
    },
    rouletteState: {
      ...base.rouletteState,
      overlayReloadNonce: Number(base.rouletteState?.overlayReloadNonce || 0) + 1,
    },
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
  return displayList.find(
    (s) =>
      normalizeManualSigNameKey(s.name) === nk &&
      Math.floor(Number(s.price || 0)) === price
  );
}

/** 업로드 경로·from-drive·인벤 URL 중 OBS에 가장 잘 먹는 경로 선택 */
function pickBestManualSigStoredImageUrl(
  urls: Array<string | undefined | null>
): string {
  const list = urls.map((u) => String(u || "").trim()).filter(Boolean);
  const upload = list.find((u) => u.startsWith("/uploads/sigs/"));
  if (upload) return upload;
  const fromDrive = list.find((u) => u.includes("/from-drive/"));
  if (fromDrive) return fromDrive;
  const bundled = list.find((u) => u.startsWith("/images/sigs/"));
  if (bundled) return bundled;
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
  const imageUrl = pickBestManualSigStoredImageUrl([
    fromSource,
    draftRow?.imageUrl,
    item.imageUrl,
    h.imageUrl,
    fromNamePrice,
  ]);
  return { ...h, name: String(item.name || h.name || "").trim() || h.name, memberId: "", imageUrl };
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

const MIN_MANUAL_OVERLAY_SIGS = 2;
/** 수동 리롤 — 풀에 2개 이상이면 최대 5개까지 랜덤 */
export const MANUAL_REROLL_MIN_POOL = MIN_MANUAL_OVERLAY_SIGS;
export const MANUAL_REROLL_MAX_PICK = 5;

export function soldFlagsWithOneShotCascade(
  flags: boolean[],
  oneShotMarkSold: boolean,
  slotCount = 5
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

/** 체크된 시그·한방 → 재고 soldCount 반영 + CONFIRMED */
export function buildManualSigSalesConfirmState(
  base: AppState,
  opts: {
    selected: SigItem[];
    sigSoldFlags: boolean[];
    oneShotMarkSold: boolean;
  }
): AppState {
  const cascadeFlags = soldFlagsWithOneShotCascade(opts.sigSoldFlags, opts.oneShotMarkSold);
  const soldPreviewSet = soldSetForFullManualRound(
    opts.selected,
    cascadeFlags,
    opts.oneShotMarkSold
  );
  const soldSigIdsForFinish = collectSoldSigIdsForFinish(opts.selected, soldPreviewSet);
  const soldTargetIds = new Set(soldSigIdsForFinish);
  const now = Date.now();
  const confirmedInventory = (base.sigInventory || []).map((row) => {
    if (row.id === ONE_SHOT_SIG_ID) {
      if (!opts.oneShotMarkSold) return row;
      const maxCount = Math.max(1, Math.floor(Number(row.maxCount || 1)));
      const soldCount = Math.max(0, Math.floor(Number(row.soldCount || 0)));
      const nextSold = Math.min(maxCount, soldCount + 1);
      return {
        ...row,
        soldCount: nextSold,
        isActive: nextSold >= maxCount ? false : row.isActive,
      };
    }
    const key = canonicalSigIdFromWheelSliceId(String(row.id || ""));
    const delta = soldTargetIds.has(key) ? 1 : 0;
    if (!delta) return row;
    const maxCount = Math.max(1, Math.floor(Number(row.maxCount || 1)));
    const soldCount = Math.max(0, Math.floor(Number(row.soldCount || 0)));
    const nextSold = Math.min(maxCount, soldCount + delta);
    return {
      ...row,
      soldCount: nextSold,
      isActive: nextSold >= maxCount ? false : row.isActive,
    };
  });
  const draftPersist = buildManualSigSoldPersistState(base, {
    sigSoldFlags: cascadeFlags,
    oneShotMarkSold: opts.oneShotMarkSold,
  });
  return {
    ...draftPersist,
    sigInventory: confirmedInventory,
    rouletteState: {
      ...draftPersist.rouletteState,
      phase: "CONFIRMED",
      lastFinishedAt: now,
      overlayReloadNonce: Number(draftPersist.rouletteState?.overlayReloadNonce || 0) + 1,
    },
    updatedAt: now,
  };
}

/** 수동 OBS — 서버 LANDED 당첨 + 초안 폴백(리롤 직후 pick 지연 대비) */
export function resolveManualOverlaySelectedSigs(
  state: AppState | null | undefined,
  userId: string
): SigItem[] {
  if (!state?.rouletteState) return [];
  const rs = state.rouletteState;
  const raw = (
    Array.isArray(rs.selectedSigs) && rs.selectedSigs.length > 0
      ? rs.selectedSigs
      : Array.isArray(rs.results)
        ? rs.results
        : []
  ) as SigItem[];
  const inv = state.sigInventory || [];
  const draft = readManualSigDraftFromState(state);
  const draftRows = Array.isArray(draft?.drafts) ? draft!.drafts : [];
  let items = stripBundledSigPlaceholderItems(
    raw.map((s) =>
      hydrateManualOverlaySigItem(
        s,
        inv,
        userId,
        resolveManualDraftRowForSigItem(s, draftRows)
      )
    )
  );
  if (items.length < MIN_MANUAL_OVERLAY_SIGS && draft && manualSigDraftsReady(draft.drafts)) {
    items = stripBundledSigPlaceholderItems(
      buildManualSigItemsFromDrafts(draft.drafts, inv, userId)
    );
  }
  return items.slice(0, 5);
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

/** 재고에서 5개 랜덤 + 한방 합산 */
export function pickRandomManualSigBundle(
  base: AppState,
  userId: string,
  opts?: { memberFilterId?: string }
): { selected: SigItem[]; oneShot: { id: string; name: string; price: number } } | null {
  const pool = listActiveManualSigPool(base.sigInventory, {
    memberFilterId: opts?.memberFilterId,
    sigSalesExcludedIds: base.sigSalesExcludedIds,
  });
  const pickCount = Math.min(MANUAL_REROLL_MAX_PICK, pool.length);
  if (pickCount < MANUAL_REROLL_MIN_POOL) return null;
  const drafts = pickRandomManualSigDrafts(pool, pickCount);
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
  return {
    ...base,
    sigInventory: syncOneShotInventoryImage(base.sigInventory, oneShotImage),
    ...(opts?.persistDrafts
      ? {
          overlaySettings: {
            ...prevOverlaySettings,
            [MANUAL_SIG_DRAFT_STATE_KEY]: {
              ...opts.persistDrafts,
              oneShotImageUrl: oneShotImage,
            },
          },
        }
      : {}),
    rouletteState: {
      ...base.rouletteState,
      phase: "LANDED",
      isRolling: false,
      sessionId: MANUAL_OVERLAY_SESSION_ID,
      startedAt: now,
      selectedSigs: selected,
      results: selected,
      result: selected[selected.length - 1] || null,
      oneShotResult: oneShot,
      spinCount: selected.length,
      overlayReloadNonce: Number(base.rouletteState?.overlayReloadNonce || 0) + 1,
    },
    updatedAt: now,
  };
}
