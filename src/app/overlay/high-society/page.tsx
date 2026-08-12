"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useClientOnlySearchParams } from "@/hooks/useClientOnlySearchParams";
import { useOverlayRemoteState } from "@/hooks/useOverlayRemoteState";
import {
  getOverlayUserIdFromSearchParams,
  isOverlayBroadcastHost,
} from "@/lib/overlay-params";
import { getEffectiveRemainingTime } from "@/lib/timer-utils";
import {
  buildHighSocietyFieldFromAppState,
  buildHighSocietyFieldFromMembers,
  formatCm,
  formatHighSocietyTimer,
  HIGH_SOCIETY_ROUND_SEC,
  HIGH_SOCIETY_TEST_MEMBERS,
  normalizeHighSocietySettings,
  parseHighSocietyBarStyle,
  parseHighSocietyRound,
  parseHighSocietySplit,
  type HighSocietyBarStyle,
  type HighSocietySeat,
} from "@/lib/high-society";
import "./high-society.css";

function RoundTimerHud({
  round,
  remainingSec,
  active,
  paused,
  ended,
}: {
  round: number;
  remainingSec: number;
  active: boolean;
  paused: boolean;
  ended: boolean;
}) {
  const low = !ended && remainingSec > 0 && remainingSec <= 5 * 60;
  const critical = !ended && remainingSec > 0 && remainingSec <= 60;
  const label = ended
    ? "종료"
    : paused
      ? "일시정지"
      : active
        ? "진행"
        : "대기";

  return (
    <div
      className={`hs-round-timer${low ? " hs-round-low" : ""}${critical ? " hs-round-critical" : ""}${
        ended ? " hs-round-ended" : ""
      }${paused ? " hs-round-paused" : ""}`}
      aria-label={`라운드 ${round} 타이머 ${formatHighSocietyTimer(remainingSec)}`}
    >
      <span className="hs-round-badge">ROUND {round}</span>
      <span className="hs-round-clock">{formatHighSocietyTimer(remainingSec)}</span>
      <span className="hs-round-state">
        {active && !paused && !ended ? "●" : "○"} {label}
      </span>
    </div>
  );
}

function dirGlyph(dir: HighSocietySeat["expandDir"]): string {
  if (dir === "right") return "→";
  if (dir === "left") return "←";
  return "↔";
}

function TerritoryGauge({
  style,
  seats,
}: {
  style: HighSocietyBarStyle;
  seats: HighSocietySeat[];
  fieldCm?: number;
}) {
  const [ready, setReady] = useState(false);
  const [flashIds, setFlashIds] = useState<Record<string, number>>({});
  const prevWidthsRef = useRef<Record<string, number>>({});
  const flashSeq = useRef(0);

  useEffect(() => {
    const id = window.setTimeout(() => setReady(true), 40);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    const grown: string[] = [];
    for (const seat of seats) {
      const prev = prevWidthsRef.current[seat.id];
      if (prev != null && seat.widthCm > prev + 0.05) grown.push(seat.id);
      prevWidthsRef.current[seat.id] = seat.widthCm;
    }
    if (grown.length === 0) return;
    flashSeq.current += 1;
    const token = flashSeq.current;
    setFlashIds((prev) => {
      const next = { ...prev };
      for (const id of grown) next[id] = token;
      return next;
    });
    const t = window.setTimeout(() => {
      setFlashIds((prev) => {
        const next = { ...prev };
        for (const id of grown) {
          if (next[id] === token) delete next[id];
        }
        return next;
      });
    }, 1100);
    return () => window.clearTimeout(t);
  }, [seats]);

  const alive = seats.filter((s) => !s.eliminated);
  if (alive.length === 0) {
    return (
      <div className="hs-field" aria-label="영토 전장">
        <div className="hs-field-wall" title="장벽">
          벽
        </div>
        <div className="hs-field-track">
          <div className="hs-territory-empty">후원 대기 중 · 상류사회</div>
        </div>
        <div className="hs-field-wall" title="장벽">
          벽
        </div>
      </div>
    );
  }

  return (
    <div
      className={`hs-field hs-field-${style}${ready ? " hs-field-ready" : ""}`}
      aria-label={`영토 전장 (${style === "arrow" ? "화살표" : "평평"})`}
    >
      <div className="hs-field-wall" title="장벽(이동 불가)">
        벽
      </div>
      <div className="hs-field-track">
        {alive.map((seat) => {
          const growing = Boolean(flashIds[seat.id]);
          return (
            <div
              key={seat.id}
              className={`hs-field-seg hs-field-${seat.letter.toLowerCase()}${
                growing ? " hs-field-seg-growing" : ""
              }`}
              style={{
                flexGrow: ready ? Math.max(seat.widthCm, 0.01) : 0.01,
                flexBasis: 0,
                background: seat.color,
              }}
              title={`${seat.letter} ${seat.name} · ${formatCm(seat.widthCm)} · 확장 ${formatCm(seat.expandCm)}`}
            >
              <span className="hs-field-label">
                {seat.letter} : {formatCm(seat.widthCm)}
              </span>
              <span className="hs-field-dir" aria-hidden>
                {dirGlyph(seat.expandDir)}
              </span>
              {style === "arrow" ? <span className="hs-field-arrow-tip" aria-hidden /> : null}
            </div>
          );
        })}
      </div>
      <div className="hs-field-wall" title="장벽(이동 불가)">
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
  const barFromUrl = sp.get("bar") || sp.get("gauge");
  const roundFromUrl = sp.get("round") || sp.get("r");
  const split = parseHighSocietySplit(sp.get("bLeft") || sp.get("b"), sp.get("cLeft") || sp.get("c"));
  const hasUrlSplit = Boolean(sp.get("bLeft") || sp.get("b") || sp.get("cLeft") || sp.get("c"));

  const { state, ready } = useOverlayRemoteState(userId);
  const [nowTick, setNowTick] = useState(() => Date.now());
  /** test 전용: 서버 타이머 없을 때 로컬 카운트다운 앵커 */
  const [demoAnchor] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  const hsSettings = useMemo(
    () => normalizeHighSocietySettings(state?.highSocietySettings),
    [state?.highSocietySettings]
  );

  const barStyle: HighSocietyBarStyle = barFromUrl
    ? parseHighSocietyBarStyle(barFromUrl)
    : hsSettings.barStyle || "flat";
  const round = roundFromUrl ? parseHighSocietyRound(roundFromUrl) : hsSettings.round || 1;

  const demoTimerSec = useMemo(() => {
    const raw = Number(sp.get("timerSec") || sp.get("timer"));
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : HIGH_SOCIETY_ROUND_SEC;
  }, [sp]);

  const field = useMemo(() => {
    if (useTest) {
      return buildHighSocietyFieldFromMembers(HIGH_SOCIETY_TEST_MEMBERS, {
        fieldCm: hsSettings.fieldCm,
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
      return buildHighSocietyFieldFromMembers([], { fieldCm: hsSettings.fieldCm });
    }
    return buildHighSocietyFieldFromAppState(state);
  }, [useTest, state, hsSettings, hasUrlSplit, split]);

  const timerState = state?.generalTimer || null;
  const timerEnabled = state?.matchTimerEnabled?.general !== false;

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

  const timerActive = timerState
    ? Boolean(timerState.isActive) && remainingSec > 0
    : useTest && remainingSec > 0;
  const timerPaused = timerState ? !timerState.isActive && remainingSec > 0 : false;
  const timerEnded = remainingSec <= 0 && (Boolean(timerState) || useTest);

  if (!spReady) return null;
  if (!ready && !useTest) {
    return (
      <main className="hs-overlay-root flex items-start justify-center p-4 text-sm text-white/70">
        상류사회 오버레이 불러오는 중…
      </main>
    );
  }

  return (
    <main className={`hs-overlay-root${hostObs ? " hs-host-obs" : ""}`}>
      <div id="hs-overlay-container">
        {useTest ? <div className="hs-test-badge">TEST</div> : null}

        <TerritoryGauge style={barStyle} seats={field.seats} />

        {timerEnabled ? (
          <RoundTimerHud
            round={round}
            remainingSec={remainingSec}
            active={timerActive}
            paused={timerPaused}
            ended={timerEnded}
          />
        ) : null}
      </div>
    </main>
  );
}
