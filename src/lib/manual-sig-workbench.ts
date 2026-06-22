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
  /** 당첨 시그 칸 수(2~20). 미설정 시 5 */
  pickCount?: number;
};

export const MAX_MANUAL_SIG_SLOTS = 8;
export const DEFAULT_MANUAL_SLOT_COUNT = 3;

/** 수동·랜덤 당첨 시그 개수 — 기본 5, 최소 2(한방), 최대 20(회전판과 동일) */
export const MIN_MANUAL_SIG_PICK_COUNT = 2;
export const MAX_MANUAL_SIG_PICK_COUNT = 20;
export const DEFAULT_MANUAL_SIG_PICK_COUNT = 5;
export const MANUAL_SIG_PICK_COUNT_KEY = "sigSalesManualPickCount";

export function clampManualSigPickCount(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return DEFAULT_MANUAL_SIG_PICK_COUNT;
  return Math.max(MIN_MANUAL_SIG_PICK_COUNT, Math.min(MAX_MANUAL_SIG_PICK_COUNT, n));
}

export function readManualSigPickCountFromOverlaySettings(
  os: Record<string, unknown> | undefined | null
): number {
  if (!os || typeof os !== "object") return DEFAULT_MANUAL_SIG_PICK_COUNT;
  const direct = os[MANUAL_SIG_PICK_COUNT_KEY];
  if (direct != null && direct !== "") return clampManualSigPickCount(direct);
  const wb = os[MANUAL_SIG_WORKBENCH_KEY];
  if (wb && typeof wb === "object") {
    const fromWb = (wb as Record<string, unknown>).pickCount;
    if (fromWb != null && fromWb !== "") return clampManualSigPickCount(fromWb);
  }
  return DEFAULT_MANUAL_SIG_PICK_COUNT;
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
