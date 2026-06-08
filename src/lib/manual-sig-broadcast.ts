import type { AppState, SigItem } from "@/types";
import {
  DEFAULT_ONE_SHOT_SIG_BUNDLED_IMAGE,
  isDedicatedOneShotSigImageUrl,
  normalizeSigImageUrlStored,
  isLegacyRomanizedFlatSigPath,
  resolveSigBundledFromDriveByName,
  resolveSigOverlayCardImageUrl,
} from "@/lib/constants";
import { buildOneShotFromSelected, resolveOneShotDisplayPrice } from "@/lib/sig-one-shot-price";
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
  findSigInventoryByName,
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
  const tempState: AppState = {
    ...base,
    overlaySettings: {
      ...prevOverlaySettings,
      [MANUAL_SIG_DRAFT_STATE_KEY]: draftPayload,
    },
  };
  const selected = resolveManualOverlaySelectedSigs(tempState, userId);
  const oneShotDisplay = resolveManualOneShotDisplayFromState(tempState, selected, userId);
  const prevOneShot = base.rouletteState?.oneShotResult;
  const oneShotResult = oneShotDisplay ?? prevOneShot ?? null;
  return {
    ...base,
    overlaySettings: {
      ...prevOverlaySettings,
      [MANUAL_SIG_DRAFT_STATE_KEY]: draftPayload,
    },
    rouletteState: {
      ...base.rouletteState,
      ...(oneShotResult ? { oneShotResult } : {}),
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

function hasUsableManualSigImageUrl(url: string | undefined | null): boolean {
  const s = String(url || "").trim();
  if (!s || s.toLowerCase().includes("dummy-sig.svg")) return false;
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
  if (!Array.isArray(drafts) || !manualSigDraftsReady(drafts)) return items;
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
    return item;
  });
}

/** 업로드 경로·from-drive·인벤 URL 중 OBS에 가장 잘 먹는 경로 선택 */
function pickBestManualSigStoredImageUrl(
  urls: Array<string | undefined | null>,
  sigName?: string
): string {
  const list = urls
    .map((u) => String(u || "").trim())
    .filter((u) => Boolean(u) && !isLegacyRomanizedFlatSigPath(u));
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
  const fromName = inventory?.length
    ? findSigInventoryByName(inventory, displayName)?.imageUrl
    : "";
  const imageUrl = pickBestManualSigStoredImageUrl(
    [fromSource, fromName, fromNamePrice, h.imageUrl, draftRow?.imageUrl, item.imageUrl],
    displayName
  );
  return { ...h, name: displayName, memberId: "", imageUrl };
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

/** 체크된 시그·한방 → 재고 soldCount 반영 (+ 선택 시 라운드 LANDED 유지) */
export function buildManualSigSalesConfirmState(
  base: AppState,
  opts: {
    selected: SigItem[];
    sigSoldFlags: boolean[];
    oneShotMarkSold: boolean;
    userId?: string;
    /** 재고 +1은 이번에 새로 true 된 슬롯만 (이중 차감 방지) */
    previousSoldFlags?: boolean[];
    previousOneShotMarkSold?: boolean;
    /** false면 phase LANDED — 나머지 시그 개별 확정 가능 */
    closeRound?: boolean;
  }
): AppState {
  const prevFlags = Array.isArray(opts.previousSoldFlags)
    ? opts.previousSoldFlags
    : [false, false, false, false, false];
  const prevOneShot = Boolean(opts.previousOneShotMarkSold);
  const cascadeFlags = soldFlagsWithOneShotCascade(opts.sigSoldFlags, opts.oneShotMarkSold);
  const deltaFlags = cascadeFlags.map((f, i) => f && !Boolean(prevFlags[i]));
  const deltaOneShot = opts.oneShotMarkSold && !prevOneShot;
  const soldTargetIds = resolveManualSoldInventoryTargetIds(
    base,
    opts.selected,
    String(opts.userId || "").trim(),
    deltaFlags,
    deltaOneShot
  );
  const now = Date.now();
  const confirmedInventory = (base.sigInventory || []).map((row) => {
    if (row.id === ONE_SHOT_SIG_ID) {
      if (!deltaOneShot) return row;
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
    userId: opts.userId,
  });
  const closeRound = opts.closeRound !== false;
  return {
    ...draftPersist,
    sigInventory: confirmedInventory,
    rouletteState: {
      ...draftPersist.rouletteState,
      phase: closeRound ? "CONFIRMED" : "LANDED",
      ...(closeRound ? { lastFinishedAt: now } : {}),
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
  const draftReady = Boolean(draft && manualSigDraftsReady(draft.drafts));
  const draftItems = draftReady
    ? stripBundledSigPlaceholderItems(buildManualSigItemsFromDrafts(draft!.drafts, inv, userId))
    : [];
  const rawNames = raw.map((s) => normalizeManualSigNameKey(s.name)).join("|");
  const draftNames = draftItems.map((s) => normalizeManualSigNameKey(s.name)).join("|");
  const draftMatchesSelection =
    draftItems.length >= MIN_MANUAL_OVERLAY_SIGS &&
    raw.length >= MIN_MANUAL_OVERLAY_SIGS &&
    rawNames === draftNames;

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
  if (
    draftItems.length >= MIN_MANUAL_OVERLAY_SIGS &&
    (items.length < MIN_MANUAL_OVERLAY_SIGS || !draftMatchesSelection)
  ) {
    items = draftItems;
  } else if (items.length < MIN_MANUAL_OVERLAY_SIGS && draftReady) {
    items = stripBundledSigPlaceholderItems(
      buildManualSigItemsFromDrafts(draft.drafts, inv, userId)
    );
  } else if (draft?.drafts?.length) {
    items = patchManualOverlaySigImagesFromDraft(items, draft.drafts, inv, userId);
  }
  return items.slice(0, 5);
}

/** 판매 확정·체크에 따라 한방 표시 금액(당첨 합계 − 판매분) */
export function resolveManualOneShotDisplayFromState(
  state: AppState | null | undefined,
  selected: SigItem[],
  userId: string
): { id: string; name: string; price: number } | null {
  if (selected.length < MIN_MANUAL_OVERLAY_SIGS) return null;
  const draft = readManualSigDraftFromState(state);
  const soldIdSet = buildManualOverlaySoldOverrideSet(state, selected, userId);
  const rs = state?.rouletteState?.oneShotResult;
  return resolveOneShotDisplayPrice({
    selected: selected.map((s) => ({
      id: s.id,
      price: Math.max(0, Math.floor(Number(s.price || 0))),
    })),
    soldIdSet,
    manualPriceInput: draft?.oneShotPriceInput,
    fallbackName: draft?.oneShotName ?? rs?.name,
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
