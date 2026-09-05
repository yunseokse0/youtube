import type { TimerDisplayStyle, AppState } from "@/types";
import { isHiddenTimerDisplayStyle } from "@/lib/overlay-params";
import { isDefaultTimerDesign, normalizeTimerDesign } from "@/lib/timer-design";
import { normalizeVsDesign } from "@/lib/vs-design";
import { normalizeTimerFontFamily } from "@/lib/timer-font-style";

function defaultTimerDisplayStyle(): TimerDisplayStyle {
  return {
    showHours: false,
    design: "pill",
    fontFamily: "mono",
    fontColor: "",
    bgColor: "",
    borderColor: "",
    outlineColor: "",
    outlineWidth: 0.8,
    bgOpacity: 40,
    scalePercent: 100,
  };
}

export { defaultTimerDisplayStyle };

export function normalizeTimerDisplayStyle(input: unknown): TimerDisplayStyle {
  const v = input && typeof input === "object" ? (input as Partial<TimerDisplayStyle>) : {};
  const op = Number(v.bgOpacity);
  const scale = Number(v.scalePercent);
  const outlineWidth = Number(v.outlineWidth);
  const fontFamilyRaw = typeof v.fontFamily === "string" ? v.fontFamily.trim() : "";
  return {
    showHours: typeof v.showHours === "boolean" ? v.showHours : false,
    design: normalizeTimerDesign(v.design),
    fontFamily: normalizeTimerFontFamily(fontFamilyRaw || "mono"),
    fontColor: typeof v.fontColor === "string" ? v.fontColor : "",
    bgColor: typeof v.bgColor === "string" ? v.bgColor : "",
    borderColor: typeof v.borderColor === "string" ? v.borderColor : "",
    outlineColor: typeof v.outlineColor === "string" ? v.outlineColor : "",
    outlineWidth: Number.isFinite(outlineWidth) ? Math.max(0, Math.min(3, Number(outlineWidth.toFixed(1)))) : 0.8,
    bgOpacity: Number.isFinite(op) ? Math.max(0, Math.min(100, Math.round(op))) : 40,
    scalePercent: Number.isFinite(scale) ? Math.max(50, Math.min(250, Math.round(scale))) : 100,
  };
}

function normalizeTimerDisplayStyles(input: unknown): AppState["timerDisplayStyles"] {
  const v = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  return {
    general: normalizeTimerDisplayStyle(v.general),
  };
}

export { normalizeTimerDisplayStyles };

export function isDefaultLikeTimerDisplayStyle(
  style: TimerDisplayStyle | null | undefined
): boolean {
  if (!style) return true;
  if (isHiddenTimerDisplayStyle(style)) return false;
  const font = String(style.fontFamily || "")
    .trim()
    .toLowerCase();
  const fontIsDefault = !font || font === "mono" || font === "default" || font === "auto";
  const bgOpacity = Number(style.bgOpacity);
  const scalePercent = Number(style.scalePercent);
  const outlineWidth = Number(style.outlineWidth);
  const outlineWidthIsDefault =
    !Number.isFinite(outlineWidth) || Math.abs(outlineWidth - 0.8) < 0.05;
  return (
    fontIsDefault &&
    isDefaultTimerDesign(style.design) &&
    !String(style.fontColor || "").trim() &&
    !String(style.bgColor || "").trim() &&
    !String(style.borderColor || "").trim() &&
    !String(style.outlineColor || "").trim() &&
    outlineWidthIsDefault &&
    (!Number.isFinite(bgOpacity) || bgOpacity === 40) &&
    (!Number.isFinite(scalePercent) || scalePercent === 100)
  );
}

export function hasCustomTimerDisplayStyles(
  styles: AppState["timerDisplayStyles"] | null | undefined
): boolean {
  return !isDefaultLikeTimerDisplayStyle(styles?.general);
}

export function mergeRemoteTimerDisplayStyles(opts: {
  last?: AppState["timerDisplayStyles"] | null;
  incoming?: AppState["timerDisplayStyles"] | null;
  hasIncomingKey: boolean;
}): AppState["timerDisplayStyles"] | undefined {
  const last = opts.last ?? undefined;
  const incoming = opts.incoming ?? undefined;
  const incomingHidden = isHiddenTimerDisplayStyle(incoming?.general);
  if (incomingHidden && incoming) return incoming;
  const preferLastColors =
    hasCustomTimerDisplayStyles(last) &&
    !incomingHidden &&
    (!opts.hasIncomingKey || isDefaultLikeTimerDisplayStyle(incoming?.general));
  const withIncomingDesign = (
    base: NonNullable<AppState["timerDisplayStyles"]>
  ): AppState["timerDisplayStyles"] => {
    const incomingDesign = incoming?.general?.design;
    if (!incomingDesign) return base;
    if (normalizeTimerDesign(incomingDesign) === normalizeTimerDesign(base.general?.design)) {
      return base;
    }
    return {
      general: {
        ...base.general,
        design: normalizeTimerDesign(incomingDesign),
        fontFamily: incoming?.general?.fontFamily || base.general.fontFamily,
        showHours: incoming?.general?.showHours ?? base.general.showHours,
        scalePercent: incoming?.general?.scalePercent ?? base.general.scalePercent,
      },
    };
  };
  if (preferLastColors && last) {
    return withIncomingDesign(last);
  }
  if (!opts.hasIncomingKey && last && !isHiddenTimerDisplayStyle(last.general)) return last;
  if (incoming && last && hasCustomTimerDisplayStyles(last)) {
    return withIncomingDesign({
      general: {
        ...last.general,
        ...incoming.general,
        fontColor: incoming.general.fontColor || last.general.fontColor,
        bgColor: incoming.general.bgColor || last.general.bgColor,
        borderColor: incoming.general.borderColor || last.general.borderColor,
        outlineColor: incoming.general.outlineColor || last.general.outlineColor,
      },
    });
  }
  return incoming ?? last;
}

export function resolveTimerDisplayStylesForVisualSave(
  foundation: AppState | null | undefined,
  local: AppState | null | undefined,
  base: AppState | null | undefined
): AppState["timerDisplayStyles"] {
  const foundationStyles = foundation?.timerDisplayStyles;
  const localStyles = local?.timerDisplayStyles;
  const baseStyles = base?.timerDisplayStyles ?? normalizeTimerDisplayStyles(undefined);
  const foundationAt = Number(foundation?.updatedAt || 0);
  const localAt = Number(local?.updatedAt || 0);
  const localCustom = hasCustomTimerDisplayStyles(localStyles);
  const foundationCustom = hasCustomTimerDisplayStyles(foundationStyles);

  if (foundationStyles && foundationAt >= localAt && foundationCustom) {
    return foundationStyles;
  }
  if (localCustom && localStyles) {
    return localStyles;
  }
  if (foundationCustom && foundationStyles) {
    return foundationStyles;
  }
  return baseStyles;
}

export {
  isHiddenTimerDisplayStyle,
  normalizeTimerDesign,
  normalizeVsDesign,
  normalizeTimerFontFamily,
};
