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
};

export const MAX_MANUAL_SIG_SLOTS = 8;
export const DEFAULT_MANUAL_SLOT_COUNT = 3;

export function newManualSlotId(): string {
  return `mslot_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function emptyManualDrafts(): ManualSigDraft[] {
  return Array.from({ length: 5 }, () => ({ name: "", priceInput: "", imageUrl: "" }));
}

export function createEmptyManualSlot(name: string, id?: string): ManualSigSlot {
  return {
    id: id || newManualSlotId(),
    name,
    inputMode: "free",
    drafts: emptyManualDrafts(),
    oneShotName: "한방 시그",
    oneShotPriceInput: "",
    oneShotImageUrl: "",
    sigSoldFlags: [false, false, false, false, false],
    oneShotMarkSold: false,
  };
}

export function defaultManualSigWorkbench(): ManualSigWorkbench {
  const slots = [
    createEmptyManualSlot("준비 1", "mslot-1"),
    createEmptyManualSlot("준비 2", "mslot-2"),
    createEmptyManualSlot("준비 3", "mslot-3"),
  ];
  return {
    version: 1,
    slots,
    activeSlotId: slots[0].id,
    broadcastSlotId: undefined,
  };
}

function normalizeDrafts(raw: unknown): ManualSigDraft[] {
  if (!Array.isArray(raw)) return emptyManualDrafts();
  const rows = raw.slice(0, 5).map((x) => {
    const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
    return {
      sourceSigId: String(o.sourceSigId || "").trim() || undefined,
      name: String(o.name || ""),
      priceInput: String(o.priceInput || ""),
      imageUrl: String(o.imageUrl || ""),
    };
  });
  while (rows.length < 5)
    rows.push({ sourceSigId: undefined, name: "", priceInput: "", imageUrl: "" });
  return rows;
}

function normalizeSlot(raw: unknown, idx: number): ManualSigSlot | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const drafts = normalizeDrafts(o.drafts);
  const flagsRaw = Array.isArray(o.sigSoldFlags) ? o.sigSoldFlags : [];
  const sigSoldFlags = Array.from({ length: 5 }, (_, i) => Boolean(flagsRaw[i]));
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

export function normalizeManualSigDraftPersist(raw: unknown): ManualSigDraftPersist | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.drafts)) return null;
  const flagsRaw = Array.isArray(o.sigSoldFlags) ? o.sigSoldFlags : [];
  return {
    inputMode: o.inputMode === "inventory" ? "inventory" : "free",
    drafts: normalizeDrafts(o.drafts),
    oneShotName: typeof o.oneShotName === "string" ? o.oneShotName : "한방 시그",
    oneShotPriceInput: typeof o.oneShotPriceInput === "string" ? o.oneShotPriceInput : "",
    oneShotImageUrl: typeof o.oneShotImageUrl === "string" ? o.oneShotImageUrl : "",
    sigSoldFlags: Array.from({ length: 5 }, (_, i) => Boolean(flagsRaw[i])),
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
  name: string
): ManualSigSlot {
  return {
    id,
    name,
    inputMode: persist.inputMode === "inventory" ? "inventory" : "free",
    drafts: normalizeDrafts(persist.drafts),
    oneShotName: persist.oneShotName,
    oneShotPriceInput: persist.oneShotPriceInput,
    oneShotImageUrl: persist.oneShotImageUrl,
    sigSoldFlags: persist.sigSoldFlags.length === 5
      ? persist.sigSoldFlags
      : [false, false, false, false, false],
    oneShotMarkSold: persist.oneShotMarkSold,
  };
}

export function normalizeManualSigWorkbench(
  raw: unknown,
  legacyDraft?: unknown
): ManualSigWorkbench {
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o.slots)) {
      const slots = o.slots
        .map((s, i) => normalizeSlot(s, i))
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
        return { version: 1, slots, activeSlotId, broadcastSlotId };
      }
    }
  }
  const legacy = normalizeManualSigDraftPersist(legacyDraft);
  if (legacy) {
    const base = defaultManualSigWorkbench();
    base.slots[0] = draftPersistToSlot(legacy, base.slots[0].id, base.slots[0].name);
    return base;
  }
  return defaultManualSigWorkbench();
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
  }
): ManualSigSlot {
  return {
    id: slotId,
    name: slotName,
    inputMode: form.inputMode,
    drafts: normalizeDrafts(form.drafts),
    oneShotName: form.oneShotName,
    oneShotPriceInput: form.oneShotPriceInput,
    oneShotImageUrl: form.oneShotImageUrl,
    sigSoldFlags:
      form.sigSoldFlags.length === 5
        ? form.sigSoldFlags.map(Boolean)
        : [false, false, false, false, false],
    oneShotMarkSold: form.oneShotMarkSold,
  };
}

export function applyManualSlotToForm(slot: ManualSigSlot): {
  inputMode: ManualInputMode;
  drafts: ManualSigDraft[];
  oneShotName: string;
  oneShotPriceInput: string;
  oneShotImageUrl: string;
  sigSoldFlags: boolean[];
  oneShotMarkSold: boolean;
} {
  return {
    inputMode: slot.inputMode,
    drafts: normalizeDrafts(slot.drafts),
    oneShotName: slot.oneShotName,
    oneShotPriceInput: slot.oneShotPriceInput,
    oneShotImageUrl: slot.oneShotImageUrl,
    sigSoldFlags: [...slot.sigSoldFlags],
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
  const wbRaw = os[MANUAL_SIG_WORKBENCH_KEY];
  const legacyRaw = os[MANUAL_SIG_DRAFT_STATE_KEY];
  return normalizeManualSigWorkbench(wbRaw, legacyRaw);
}
