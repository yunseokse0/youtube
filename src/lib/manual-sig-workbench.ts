/** 수동 시그 판매 — 탭(슬롯)별 미리 준비. OBS 반영은 「수동 결과 적용」 시에만 */

export const MANUAL_SIG_WORKBENCH_KEY = "sigSalesManualWorkbenchV1";
export const MANUAL_SIG_DRAFT_STATE_KEY = "sigSalesManualDraftV1";

export type ManualInputMode = "free" | "inventory";

export type ManualSigDraft = {
  sourceSigId?: string;
  name: string;
  priceInput: string;
  imageUrl: string;
};

export type ManualSigDraftPersist = {
  inputMode?: ManualInputMode;
  drafts: ManualSigDraft[];
  oneShotName: string;
  oneShotPriceInput: string;
  oneShotImageUrl: string;
  sigSoldFlags: boolean[];
  oneShotMarkSold: boolean;
};

export type ManualSigSlot = {
  id: string;
  name: string;
  inputMode: ManualInputMode;
  drafts: ManualSigDraft[];
  oneShotName: string;
  oneShotPriceInput: string;
  oneShotImageUrl: string;
  sigSoldFlags: boolean[];
  oneShotMarkSold: boolean;
};

export type ManualSigWorkbench = {
  version: 1;
  slots: ManualSigSlot[];
  activeSlotId: string;
  /** 마지막으로 OBS에 LANDED 적용한 탭 */
  broadcastSlotId?: string;
  /** 당첨 시그 칸 수(2~36). 미설정 시 5 */
  pickCount?: number;
};

export const MAX_MANUAL_SIG_SLOTS = 8;
export const DEFAULT_MANUAL_SLOT_COUNT = 3;

/** 수동·랜덤 당첨 시그 개수 — 기본 5, 최소 2(한방), 최대 36(6×6 그리드) */
export const MIN_MANUAL_SIG_PICK_COUNT = 2;
export const MAX_MANUAL_SIG_PICK_COUNT = 36;
export const DEFAULT_MANUAL_SIG_PICK_COUNT = 5;
export const MANUAL_SIG_PICK_COUNT_KEY = "sigSalesManualPickCount";
export const MANUAL_SIG_GRID_ROWS_KEY = "sigSalesManualGridRows";
export const MANUAL_SIG_GRID_COLS_KEY = "sigSalesManualGridCols";
export const MANUAL_SIG_PANEL_ORIENTATION_KEY = "sigSalesManualPanelOrientation";
/** 칸별 랜덤 금액대(min~max). 0이면 제한 없음 */
export const MANUAL_SIG_SLOT_PRICE_BANDS_KEY = "sigSalesManualSlotPriceBands";
/** toona 스트리머 기본 알림 이미지 — 시그 이미지 404·빈 URL 폴백 */
export const TOONA_DEFAULT_ALERT_IMAGE_KEY = "toonaDefaultAlertImageUrl";

export type ManualSigSlotPriceBand = {
  min: number;
  max: number;
};

export function normalizeManualSigSlotPriceBands(
  raw: unknown,
  pickCount = DEFAULT_MANUAL_SIG_PICK_COUNT
): ManualSigSlotPriceBand[] {
  const n = clampManualSigPickCount(pickCount);
  const arr = Array.isArray(raw) ? raw : [];
  return Array.from({ length: n }, (_, i) => {
    const row = arr[i];
    const o = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
    const min = Math.max(0, Math.floor(Number(o.min) || 0));
    const max = Math.max(0, Math.floor(Number(o.max) || 0));
    return {
      min,
      max: max > 0 && min > 0 && max < min ? min : max,
    };
  });
}

export function readManualSigSlotPriceBandsFromOverlaySettings(
  os: Record<string, unknown> | undefined | null,
  pickCount = DEFAULT_MANUAL_SIG_PICK_COUNT
): ManualSigSlotPriceBand[] {
  if (!os || typeof os !== "object") {
    return normalizeManualSigSlotPriceBands(undefined, pickCount);
  }
  return normalizeManualSigSlotPriceBands(os[MANUAL_SIG_SLOT_PRICE_BANDS_KEY], pickCount);
}

export function priceMatchesManualSigSlotBand(price: number, band: ManualSigSlotPriceBand): boolean {
  const p = Math.max(0, Math.floor(Number(price) || 0));
  if (band.min <= 0 && band.max <= 0) return true;
  if (band.min > 0 && p < band.min) return false;
  if (band.max > 0 && p > band.max) return false;
  return true;
}

export function readToonaDefaultAlertImageFromOverlaySettings(
  os: Record<string, unknown> | undefined | null
): string {
  if (!os || typeof os !== "object") return "";
  return String(os[TOONA_DEFAULT_ALERT_IMAGE_KEY] || "").trim();
}

export const MIN_MANUAL_SIG_GRID_ROWS = 1;
export const MAX_MANUAL_SIG_GRID_ROWS = 8;
export const MIN_MANUAL_SIG_GRID_COLS = 1;
export const MAX_MANUAL_SIG_GRID_COLS = 36;
export const DEFAULT_MANUAL_SIG_GRID_ROWS = 1;
export const DEFAULT_MANUAL_SIG_GRID_COLS = 5;

export type SigSalesPanelOrientation = "landscape" | "portrait";

export type ManualSigGrid = {
  rows: number;
  cols: number;
  pickCount: number;
};

function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function normalizeManualSigPanelOrientation(raw: unknown): SigSalesPanelOrientation {
  return raw === "portrait" ? "portrait" : "landscape";
}

/** 행×열. 칸 수는 2~36으로 맞춘다. */
export function normalizeManualSigGrid(rowsRaw: unknown, colsRaw: unknown): ManualSigGrid {
  let rows = clampInt(rowsRaw, MIN_MANUAL_SIG_GRID_ROWS, MAX_MANUAL_SIG_GRID_ROWS, DEFAULT_MANUAL_SIG_GRID_ROWS);
  let cols = clampInt(colsRaw, MIN_MANUAL_SIG_GRID_COLS, MAX_MANUAL_SIG_GRID_COLS, DEFAULT_MANUAL_SIG_GRID_COLS);
  let pickCount = rows * cols;
  if (pickCount < MIN_MANUAL_SIG_PICK_COUNT) {
    cols = Math.min(MAX_MANUAL_SIG_GRID_COLS, Math.max(cols, Math.ceil(MIN_MANUAL_SIG_PICK_COUNT / rows)));
    pickCount = rows * cols;
    if (pickCount < MIN_MANUAL_SIG_PICK_COUNT) {
      rows = 1;
      cols = MIN_MANUAL_SIG_PICK_COUNT;
      pickCount = cols;
    }
  }
  if (pickCount > MAX_MANUAL_SIG_PICK_COUNT) {
    cols = Math.max(MIN_MANUAL_SIG_GRID_COLS, Math.floor(MAX_MANUAL_SIG_PICK_COUNT / rows));
    pickCount = rows * cols;
    if (pickCount < MIN_MANUAL_SIG_PICK_COUNT || pickCount > MAX_MANUAL_SIG_PICK_COUNT) {
      rows = 1;
      cols = MAX_MANUAL_SIG_PICK_COUNT;
      pickCount = cols;
    }
  }
  return { rows, cols, pickCount };
}

export function readManualSigPanelOrientationFromOverlaySettings(
  os: Record<string, unknown> | undefined | null
): SigSalesPanelOrientation {
  if (!os || typeof os !== "object") return "portrait";
  const raw = os[MANUAL_SIG_PANEL_ORIENTATION_KEY];
  if (raw === "landscape" || raw === "portrait") return raw;
  /** 기존 방송 결과 카드는 세로 프레임 */
  return "portrait";
}

export function readManualSigGridFromOverlaySettings(
  os: Record<string, unknown> | undefined | null
): ManualSigGrid {
  const pickFallback = (() => {
    if (!os || typeof os !== "object") return DEFAULT_MANUAL_SIG_PICK_COUNT;
    const direct = os[MANUAL_SIG_PICK_COUNT_KEY];
    if (direct != null && direct !== "") return clampManualSigPickCount(direct);
    const wb = os[MANUAL_SIG_WORKBENCH_KEY];
    if (wb && typeof wb === "object") {
      const fromWb = (wb as Record<string, unknown>).pickCount;
      if (fromWb != null && fromWb !== "") return clampManualSigPickCount(fromWb);
    }
    return DEFAULT_MANUAL_SIG_PICK_COUNT;
  })();
  if (!os || typeof os !== "object") {
    return normalizeManualSigGrid(DEFAULT_MANUAL_SIG_GRID_ROWS, pickFallback);
  }
  const rowsRaw = os[MANUAL_SIG_GRID_ROWS_KEY];
  const colsRaw = os[MANUAL_SIG_GRID_COLS_KEY];
  if (rowsRaw == null && colsRaw == null) {
    return normalizeManualSigGrid(1, pickFallback);
  }
  return normalizeManualSigGrid(rowsRaw ?? 1, colsRaw ?? pickFallback);
}

/** 판매완료 칸 금액 합. 한방 완료면 한방 금액(칸 합산가)을 쓴다. */
export function computeManualSoldTotal(
  prices: number[],
  soldFlags: boolean[],
  opts?: { oneShotSold?: boolean; oneShotPrice?: number }
): number {
  let sum = 0;
  const n = Math.min(prices.length, soldFlags.length);
  for (let i = 0; i < n; i++) {
    if (soldFlags[i]) sum += Math.max(0, Math.floor(Number(prices[i]) || 0));
  }
  if (opts?.oneShotSold) {
    const shot = Math.max(0, Math.floor(Number(opts.oneShotPrice) || 0));
    if (shot > 0) return shot;
  }
  return sum;
}

export function clampManualSigPickCount(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return DEFAULT_MANUAL_SIG_PICK_COUNT;
  return Math.max(MIN_MANUAL_SIG_PICK_COUNT, Math.min(MAX_MANUAL_SIG_PICK_COUNT, n));
}

export function readManualSigPickCountFromOverlaySettings(
  os: Record<string, unknown> | undefined | null
): number {
  return readManualSigGridFromOverlaySettings(os).pickCount;
}

export function emptyManualSoldFlags(count = DEFAULT_MANUAL_SIG_PICK_COUNT): boolean[] {
  const n = clampManualSigPickCount(count);
  return Array.from({ length: n }, () => false);
}

export function newManualSlotId(): string {
  return `mslot_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function emptyManualDrafts(count = DEFAULT_MANUAL_SIG_PICK_COUNT): ManualSigDraft[] {
  const n = clampManualSigPickCount(count);
  return Array.from({ length: n }, () => ({ name: "", priceInput: "", imageUrl: "" }));
}

export function resizeManualDrafts(drafts: ManualSigDraft[], count: number): ManualSigDraft[] {
  return normalizeDrafts(drafts, count);
}

export function resizeManualSoldFlags(flags: boolean[], count: number): boolean[] {
  return normalizeSoldFlags(flags, count);
}

export type ManualSigParsedRow = { name: string; price: number; imageUrl: string };

export function parseManualSigDraftRows(drafts: ManualSigDraft[]): ManualSigParsedRow[] {
  return drafts.map((row) => {
    const name = String(row.name || "").trim();
    const digits = String(row.priceInput || "").replace(/[^\d]/g, "");
    const price = digits ? Math.max(0, Math.floor(Number.parseInt(digits, 10) || 0)) : 0;
    return {
      name,
      price,
      imageUrl: String(row.imageUrl || "").trim(),
    };
  });
}

/** 수동 N칸 — 이름·금액·서로 다른 시그(또는 이름) */
export function manualSigDraftsReady(
  drafts: ManualSigDraft[],
  pickCount = DEFAULT_MANUAL_SIG_PICK_COUNT
): boolean {
  const n = clampManualSigPickCount(pickCount);
  if (!Array.isArray(drafts) || drafts.length < n) return false;
  const parsed = parseManualSigDraftRows(drafts.slice(0, n));
  if (parsed.length !== n) return false;
  if (parsed.some((row) => !row.name || row.price <= 0)) return false;
  const uniq = new Set(
    drafts.slice(0, n).map((row, idx) => {
      const sourceKey = String(row?.sourceSigId || "").trim();
      if (sourceKey) return `id:${sourceKey}`;
      return `name:${String(parsed[idx]?.name || "").toLowerCase()}`;
    })
  );
  return uniq.size === n;
}

export function createEmptyManualSlot(name: string, id?: string, pickCount = DEFAULT_MANUAL_SIG_PICK_COUNT): ManualSigSlot {
  const n = clampManualSigPickCount(pickCount);
  return {
    id: id || newManualSlotId(),
    name,
    inputMode: "free",
    drafts: emptyManualDrafts(n),
    oneShotName: "한방 시그",
    oneShotPriceInput: "",
    oneShotImageUrl: "",
    sigSoldFlags: emptyManualSoldFlags(n),
    oneShotMarkSold: false,
  };
}

function normalizeSoldFlags(raw: unknown, pickCount = DEFAULT_MANUAL_SIG_PICK_COUNT): boolean[] {
  const n = clampManualSigPickCount(pickCount);
  const flagsRaw = Array.isArray(raw) ? raw : [];
  return Array.from({ length: n }, (_, i) => Boolean(flagsRaw[i]));
}

function normalizeDrafts(raw: unknown, pickCount = DEFAULT_MANUAL_SIG_PICK_COUNT): ManualSigDraft[] {
  const n = clampManualSigPickCount(pickCount);
  if (!Array.isArray(raw)) return emptyManualDrafts(n);
  const rows = raw.slice(0, n).map((x) => {
    const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
    return {
      sourceSigId: String(o.sourceSigId || "").trim() || undefined,
      name: String(o.name || ""),
      priceInput: String(o.priceInput || ""),
      imageUrl: String(o.imageUrl || ""),
    };
  });
  while (rows.length < n) rows.push({ sourceSigId: undefined, name: "", priceInput: "", imageUrl: "" });
  return rows;
}

function normalizeSlot(raw: unknown, idx: number, pickCount: number): ManualSigSlot | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const drafts = normalizeDrafts(o.drafts, pickCount);
  const sigSoldFlags = normalizeSoldFlags(o.sigSoldFlags, pickCount);
  const inputMode = o.inputMode === "inventory" ? "inventory" : "free";
  return {
    id: String(o.id || `mslot-${idx + 1}`).trim() || `mslot-${idx + 1}`,
    name: String(o.name || `준비 ${idx + 1}`).trim() || `준비 ${idx + 1}`,
    inputMode,
    drafts,
    oneShotName: typeof o.oneShotName === "string" ? o.oneShotName : "한방 시그",
    oneShotPriceInput: typeof o.oneShotPriceInput === "string" ? o.oneShotPriceInput : "",
    oneShotImageUrl: typeof o.oneShotImageUrl === "string" ? o.oneShotImageUrl : "",
    sigSoldFlags,
    oneShotMarkSold: Boolean(o.oneShotMarkSold),
  };
}

export function normalizeManualSigDraftPersist(
  raw: unknown,
  pickCount = DEFAULT_MANUAL_SIG_PICK_COUNT
): ManualSigDraftPersist | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.drafts)) return null;
  const n = clampManualSigPickCount(pickCount);
  return {
    inputMode: o.inputMode === "inventory" ? "inventory" : "free",
    drafts: normalizeDrafts(o.drafts, n),
    oneShotName: typeof o.oneShotName === "string" ? o.oneShotName : "한방 시그",
    oneShotPriceInput: typeof o.oneShotPriceInput === "string" ? o.oneShotPriceInput : "",
    oneShotImageUrl: typeof o.oneShotImageUrl === "string" ? o.oneShotImageUrl : "",
    sigSoldFlags: normalizeSoldFlags(o.sigSoldFlags, n),
    oneShotMarkSold: Boolean(o.oneShotMarkSold),
  };
}

export function slotToDraftPersist(slot: ManualSigSlot): ManualSigDraftPersist {
  return {
    inputMode: slot.inputMode,
    drafts: slot.drafts,
    oneShotName: slot.oneShotName,
    oneShotPriceInput: slot.oneShotPriceInput,
    oneShotImageUrl: slot.oneShotImageUrl,
    sigSoldFlags: slot.sigSoldFlags,
    oneShotMarkSold: slot.oneShotMarkSold,
  };
}

export function draftPersistToSlot(
  persist: ManualSigDraftPersist,
  id: string,
  name: string,
  pickCount = DEFAULT_MANUAL_SIG_PICK_COUNT
): ManualSigSlot {
  const n = clampManualSigPickCount(pickCount);
  return {
    id,
    name,
    inputMode: persist.inputMode === "inventory" ? "inventory" : "free",
    drafts: normalizeDrafts(persist.drafts, n),
    oneShotName: persist.oneShotName,
    oneShotPriceInput: persist.oneShotPriceInput,
    oneShotImageUrl: persist.oneShotImageUrl,
    sigSoldFlags: normalizeSoldFlags(persist.sigSoldFlags, n),
    oneShotMarkSold: persist.oneShotMarkSold,
  };
}

export function normalizeManualSigWorkbench(
  raw: unknown,
  legacyDraft?: unknown,
  pickCountHint = DEFAULT_MANUAL_SIG_PICK_COUNT
): ManualSigWorkbench {
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const pickCount = clampManualSigPickCount(o.pickCount ?? pickCountHint);
    if (Array.isArray(o.slots)) {
      const slots = o.slots
        .map((s, i) => normalizeSlot(s, i, pickCount))
        .filter((s): s is ManualSigSlot => !!s)
        .slice(0, MAX_MANUAL_SIG_SLOTS);
      if (slots.length > 0) {
        const activeRaw = String(o.activeSlotId || "").trim();
        const activeSlotId = slots.some((s) => s.id === activeRaw)
          ? activeRaw
          : slots[0].id;
        const broadcastRaw = String(o.broadcastSlotId || "").trim();
        const broadcastSlotId = slots.some((s) => s.id === broadcastRaw)
          ? broadcastRaw
          : undefined;
        return { version: 1, slots, activeSlotId, broadcastSlotId, pickCount };
      }
    }
  }
  const legacyPick = clampManualSigPickCount(pickCountHint);
  const legacy = normalizeManualSigDraftPersist(legacyDraft, legacyPick);
  if (legacy) {
    const base = defaultManualSigWorkbench(legacyPick);
    base.slots[0] = draftPersistToSlot(legacy, base.slots[0].id, base.slots[0].name, legacyPick);
    return base;
  }
  return defaultManualSigWorkbench(legacyPick);
}

export function defaultManualSigWorkbench(pickCount = DEFAULT_MANUAL_SIG_PICK_COUNT): ManualSigWorkbench {
  const n = clampManualSigPickCount(pickCount);
  const slots = [
    createEmptyManualSlot("준비 1", "mslot-1", n),
    createEmptyManualSlot("준비 2", "mslot-2", n),
    createEmptyManualSlot("준비 3", "mslot-3", n),
  ];
  return {
    version: 1,
    slots,
    activeSlotId: slots[0].id,
    broadcastSlotId: undefined,
    pickCount: n,
  };
}

export function captureManualFormToSlot(
  slotId: string,
  slotName: string,
  form: {
    inputMode: ManualInputMode;
    drafts: ManualSigDraft[];
    oneShotName: string;
    oneShotPriceInput: string;
    oneShotImageUrl: string;
    sigSoldFlags: boolean[];
    oneShotMarkSold: boolean;
  },
  pickCount = DEFAULT_MANUAL_SIG_PICK_COUNT
): ManualSigSlot {
  const n = clampManualSigPickCount(pickCount);
  return {
    id: slotId,
    name: slotName,
    inputMode: form.inputMode,
    drafts: normalizeDrafts(form.drafts, n),
    oneShotName: form.oneShotName,
    oneShotPriceInput: form.oneShotPriceInput,
    oneShotImageUrl: form.oneShotImageUrl,
    sigSoldFlags: normalizeSoldFlags(form.sigSoldFlags, n),
    oneShotMarkSold: form.oneShotMarkSold,
  };
}

export function applyManualSlotToForm(
  slot: ManualSigSlot,
  pickCount = DEFAULT_MANUAL_SIG_PICK_COUNT
): {
  inputMode: ManualInputMode;
  drafts: ManualSigDraft[];
  oneShotName: string;
  oneShotPriceInput: string;
  oneShotImageUrl: string;
  sigSoldFlags: boolean[];
  oneShotMarkSold: boolean;
} {
  const n = clampManualSigPickCount(pickCount);
  return {
    inputMode: slot.inputMode,
    drafts: normalizeDrafts(slot.drafts, n),
    oneShotName: slot.oneShotName,
    oneShotPriceInput: slot.oneShotPriceInput,
    oneShotImageUrl: slot.oneShotImageUrl,
    sigSoldFlags: normalizeSoldFlags(slot.sigSoldFlags, n),
    oneShotMarkSold: slot.oneShotMarkSold,
  };
}

export function mergeActiveSlotIntoWorkbench(
  wb: ManualSigWorkbench,
  captured: ManualSigSlot
): ManualSigWorkbench {
  return {
    ...wb,
    slots: wb.slots.map((s) => (s.id === captured.id ? captured : s)),
  };
}

export function readManualSigWorkbenchFromOverlaySettings(
  os: Record<string, unknown> | undefined
): ManualSigWorkbench {
  if (!os) return defaultManualSigWorkbench();
  const pickCount = readManualSigPickCountFromOverlaySettings(os);
  const wbRaw = os[MANUAL_SIG_WORKBENCH_KEY];
  const legacyRaw = os[MANUAL_SIG_DRAFT_STATE_KEY];
  return normalizeManualSigWorkbench(wbRaw, legacyRaw, pickCount);
}
