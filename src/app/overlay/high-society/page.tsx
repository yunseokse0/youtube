"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useClientOnlySearchParams } from "@/hooks/useClientOnlySearchParams";
import { useOverlayRemoteState } from "@/hooks/useOverlayRemoteState";
import {
  getOverlayUserIdFromSearchParams,
  isOverlayBroadcastHost,
} from "@/lib/overlay-params";
import { STATE_PICK_OVERLAY_DONORS } from "@/lib/state-api-pick";
import { getEffectiveRemainingTime } from "@/lib/timer-utils";
import {
  buildHighSocietyFieldFromAppState,
  buildHighSocietyFieldFromMembers,
  detectHighSocietyGrowFlashSeatIds,
  formatCm,
  HIGH_SOCIETY_DEFAULT_FIELD_CM,
  HIGH_SOCIETY_ROUND_SEC,
  HIGH_SOCIETY_TEST_MEMBERS,
  normalizeHighSocietyFxSettings,
  normalizeHighSocietySettings,
  parseHighSocietyBarStyle,
  parseHighSocietyFieldCm,
  parseHighSocietySplit,
  type HighSocietyBarStyle,
  type HighSocietyExpandPressure,
  type HighSocietySeat,
} from "@/lib/high-society";
import "./high-society.css";

function dirGlyph(dir: HighSocietySeat["expandDir"]): string {
  if (dir === "right") return "→";
  if (dir === "left") return "←";
  return "↔";
}

function TerritoryGauge({
  style,
  seats,
  fx,
  /** 관리자 프리뷰 등 — 입장/성장 모션·flex 트랜지션 유발 움찔 방지 */
  motion = true,
}: {
  style: HighSocietyBarStyle;
  seats: HighSocietySeat[];
  fx: ReturnType<typeof normalizeHighSocietyFxSettings>;
  fieldCm?: number;
  motion?: boolean;
}) {
  const [ready, setReady] = useState(!motion);
  const [flashIds, setFlashIds] = useState<Record<string, number>>({});
  const prevExpandRef = useRef<Record<string, HighSocietyExpandPressure>>({});
  const flashSeq = useRef(0);
  /** width만이 아니라 확장 압력(방향) 변경도 감지 */
  const seatsSig = seats
    .map((s) => `${s.id}:${s.widthCm}:${s.expandLeftCm}:${s.expandRightCm}`)
    .join("|");

  useEffect(() => {
    if (!motion) {
      setReady(true);
      return;
    }
    setReady(false);
    const id = window.setTimeout(() => setReady(true), 40);
    return () => window.clearTimeout(id);
  }, [motion]);

  useEffect(() => {
    if (!motion || !fx.growFlash) return;
    const { grownIds, nextPrev } = detectHighSocietyGrowFlashSeatIds(
      seats,
      prevExpandRef.current
    );
    prevExpandRef.current = nextPrev;
    if (grownIds.length === 0) return;
    flashSeq.current += 1;
    const token = flashSeq.current;
    setFlashIds((prev) => {
      const next = { ...prev };
      for (const id of grownIds) next[id] = token;
      return next;
    });
    const t = window.setTimeout(() => {
      setFlashIds((prev) => {
        const next = { ...prev };
        for (const id of grownIds) {
          if (next[id] === token) delete next[id];
        }
        return next;
      });
    }, 1400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seats content via seatsSig
  }, [motion, seatsSig, fx.growFlash]);

  const alive = seats.filter((s) => !s.eliminated);
  if (alive.length === 0) {
    return (
      <div className="hs-field" aria-label="영토 전장">
        <div className={`hs-field-wall${fx.strongOutline ? " hs-text-outline" : ""}`} title="장벽">
          벽
        </div>
        <div className="hs-field-track">
          <div className={`hs-territory-empty${fx.strongOutline ? " hs-text-outline" : ""}`}>
            후원 대기 중 · 상류사회
          </div>
        </div>
        <div className={`hs-field-wall${fx.strongOutline ? " hs-text-outline" : ""}`} title="장벽">
          벽
        </div>
      </div>
    );
  }

  const showAtFull = ready || !motion;

  return (
    <div
      className={`hs-field hs-field-${style}${showAtFull ? " hs-field-ready" : ""}${
        motion ? "" : " hs-field-static"
      }`}
      aria-label={`영토 전장 (${style === "arrow" ? "화살표" : "평평"})`}
    >
      <div
        className={`hs-field-wall${fx.strongOutline ? " hs-text-outline" : ""}`}
        title="장벽(이동 불가)"
      >
        벽
      </div>
      <div className="hs-field-track">
        {alive.map((seat, index) => {
          const growing = motion && fx.growFlash && Boolean(flashIds[seat.id]);
          const expand = seat.expandDir === "left" || seat.expandDir === "right" ? seat.expandDir : "both";
          return (
            <div
              key={seat.id}
              className={`hs-field-seg hs-field-${seat.letter.toLowerCase()} hs-expand-${expand}${
                growing ? " hs-field-seg-growing" : ""
              }`}
              style={
                {
                  flexGrow: showAtFull ? Math.max(seat.widthCm, 0.01) : 0.01,
                  flexBasis: 0,
                  background: seat.color,
                  ["--hs-i" as string]: index,
                  ["--hs-seg-color" as string]: seat.color,
                } as CSSProperties
              }
              title={`${seat.name} · ${formatCm(seat.widthCm)} · 확장 ${formatCm(seat.expandCm)}`}
            >
              {fx.frontier ? (
                <span className={`hs-field-front hs-field-front-${expand}`} aria-hidden />
              ) : null}
              <span className={`hs-field-label${fx.strongOutline ? " hs-text-outline" : ""}`}>
                <span className="hs-field-name">{seat.name || seat.letter}</span>
                <span className="hs-field-meta">
                  <span className="hs-field-cm">{formatCm(seat.widthCm)}</span>
                  <span className="hs-field-dir" aria-hidden>
                    {dirGlyph(seat.expandDir)}
                  </span>
                </span>
              </span>
            </div>
          );
        })}
      </div>
      <div
        className={`hs-field-wall${fx.strongOutline ? " hs-text-outline" : ""}`}
        title="장벽(이동 불가)"
      >
        벽
      </div>
    </div>
  );
}

export default function HighSocietyOverlayPage() {
  const { params: sp, ready: spReady } = useClientOnlySearchParams();
  const userId = getOverlayUserIdFromSearchParams(sp);
  const hostObs = isOverlayBroadcastHost(sp);
  const useTest = (sp.get("test") || "").toLowerCase() === "true";
  const adminPreview =
    sp.get("adminPreviewEmbed") === "1" || sp.get("hubPreview") === "1";
  const barFromUrl = sp.get("bar") || sp.get("gauge");
  const split = parseHighSocietySplit(sp.get("bLeft") || sp.get("b"), sp.get("cLeft") || sp.get("c"));
  const hasUrlSplit = Boolean(sp.get("bLeft") || sp.get("b") || sp.get("cLeft") || sp.get("c"));

  const { state, ready } = useOverlayRemoteState(userId, {
    /** 후원 행·hsPushDir 없으면 영토 방향/실시간 확장이 멤버 합계만 보고 어긋남 */
    statePick: STATE_PICK_OVERLAY_DONORS,
    /** OBS: CEF LS 옛 멤버명으로 서버 개명을 덮지 않음 */
    skipLocalSnapshot: hostObs,
    forceInitialFull: hostObs,
    persistLastGood: !hostObs,
    /** 관리자 미리보기: 재배치·나누기·방향 적용이 게이지에 바로 보이게 since 폴링 */
    adminPreviewAllowPoll: true,
  });
  const [nowTick, setNowTick] = useState(() => Date.now());
  /** test 전용: 서버 타이머 없을 때 로컬 카운트다운 앵커 (라운드 종료 후 모드용) */
  const [demoAnchor] = useState(() => Date.now());

  const hsSettings = useMemo(
    () => normalizeHighSocietySettings(state?.highSocietySettings),
    [state?.highSocietySettings]
  );

  /** 실시간 모드에서는 250ms 틱이 게이지를 불필요하게 재렌더 → 프리뷰 움찔 유발 */
  const needsTimerTick =
    hsSettings.territoryUpdateMode === "onRoundEnd" || useTest;

  useEffect(() => {
    if (!needsTimerTick) return;
    const id = window.setInterval(() => setNowTick(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [needsTimerTick]);

  const barStyle: HighSocietyBarStyle = barFromUrl
    ? parseHighSocietyBarStyle(barFromUrl)
    : hsSettings.barStyle || "flat";

  const fieldCmFromUrl = parseHighSocietyFieldCm(sp.get("fieldCm") || sp.get("field"));
  const effectiveFieldCm = fieldCmFromUrl ?? hsSettings.fieldCm ?? HIGH_SOCIETY_DEFAULT_FIELD_CM;

  const demoTimerSec = useMemo(() => {
    const raw = Number(sp.get("timerSec") || sp.get("timer"));
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : HIGH_SOCIETY_ROUND_SEC;
  }, [sp]);

  const field = useMemo(() => {
    const fieldOpts = { fieldCm: effectiveFieldCm };
    if (useTest) {
      return buildHighSocietyFieldFromMembers(HIGH_SOCIETY_TEST_MEMBERS, {
        ...fieldOpts,
        split: hasUrlSplit
          ? split
          : {
              bLeft:
                hsSettings.defaultMiddlePush === "left"
                  ? 1
                  : hsSettings.defaultMiddlePush === "right"
                    ? 0
                    : 0.5,
              cLeft:
                hsSettings.defaultMiddlePush === "left"
                  ? 1
                  : hsSettings.defaultMiddlePush === "right"
                    ? 0
                    : 0.5,
            },
      });
    }
    if (!state) {
      return buildHighSocietyFieldFromMembers([], fieldOpts);
    }
    return buildHighSocietyFieldFromAppState({
      ...state,
      highSocietySettings: {
        ...normalizeHighSocietySettings(state.highSocietySettings),
        fieldCm: effectiveFieldCm,
      },
    });
  }, [useTest, state, hsSettings, hasUrlSplit, split, effectiveFieldCm]);

  const timerState = state?.generalTimer || null;

  const remainingSec = useMemo(() => {
    if (timerState) {
      return getEffectiveRemainingTime(timerState, nowTick);
    }
    if (useTest) {
      const elapsed = Math.floor((nowTick - demoAnchor) / 1000);
      return Math.max(0, demoTimerSec - elapsed);
    }
    return 0;
  }, [timerState, nowTick, useTest, demoTimerSec, demoAnchor]);

  /** 라운드 종료 후 모드: 타이머 남은 동안 게이지 동결, 종료 시 라이브 반영 (HUD 없음) */
  const roundInProgress = remainingSec > 0;
  const freezeTerritory = hsSettings.territoryUpdateMode === "onRoundEnd" && roundInProgress;
  const [frozenSeats, setFrozenSeats] = useState<HighSocietySeat[] | null>(null);
  const wasRoundInProgressRef = useRef(false);

  const fieldSeatsSig = field.seats.map((s) => `${s.id}:${s.widthCm}`).join("|");

  useEffect(() => {
    if (hsSettings.territoryUpdateMode !== "onRoundEnd") {
      wasRoundInProgressRef.current = false;
      setFrozenSeats(null);
      return;
    }
    if (roundInProgress) {
      if (!wasRoundInProgressRef.current) {
        setFrozenSeats(field.seats.map((s) => ({ ...s })));
      }
      wasRoundInProgressRef.current = true;
      return;
    }
    if (wasRoundInProgressRef.current) {
      wasRoundInProgressRef.current = false;
      setFrozenSeats(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- field.seats via fieldSeatsSig
  }, [hsSettings.territoryUpdateMode, roundInProgress, fieldSeatsSig]);

  const displaySeats =
    freezeTerritory && frozenSeats && frozenSeats.length > 0 ? frozenSeats : field.seats;

  const fx = normalizeHighSocietyFxSettings(hsSettings.fx);
  const fxClass = [
    fx.frontier ? "hs-fx-frontier" : "",
    fx.growFlash ? "hs-fx-grow" : "",
    fx.contestedEdge ? "hs-fx-contested" : "",
    fx.arrowBlade ? "hs-fx-blade" : "",
    fx.strongOutline ? "hs-fx-outline" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (!spReady) return null;
  if (!ready && !useTest) {
    return (
      <main className="hs-overlay-root flex items-start justify-center p-4 text-sm text-white/70">
        상류사회 오버레이 불러오는 중…
      </main>
    );
  }

  return (
    <main
      className={[
        "hs-overlay-root",
        hostObs ? "hs-host-obs" : "",
        adminPreview ? "hs-preview-embed" : "",
        fxClass,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div id="hs-overlay-container">
        {useTest ? <div className="hs-test-badge">TEST</div> : null}
        <TerritoryGauge
          style={barStyle}
          seats={displaySeats}
          fx={fx}
          motion={!adminPreview && fx.growFlash}
        />
      </div>
    </main>
  );
}
