"use client";

import { useEffect, useMemo, useState } from "react";
import { useClientOnlySearchParams } from "@/hooks/useClientOnlySearchParams";
import { useOverlayRemoteState } from "@/hooks/useOverlayRemoteState";
import {
  getOverlayUserIdFromSearchParams,
  isOverlayBroadcastHost,
} from "@/lib/overlay-params";
import { getEffectiveRemainingTime } from "@/lib/timer-utils";
import {
  buildHighSocietyFieldFromMembers,
  buildHighSocietyTerritory,
  buildHighSocietyZones,
  formatCm,
  formatHighSocietyTimer,
  formatManWon,
  HIGH_SOCIETY_TEST_MEMBERS,
  laneLetter,
  laneSolidColor,
  parseHighSocietyBarStyle,
  parseHighSocietySplit,
  type HighSocietyBarStyle,
  type HighSocietySeat,
  type HighSocietyTerritorySlice,
} from "@/lib/high-society";
import "./high-society.css";

function FieldGauge({ seats }: { seats: HighSocietySeat[] }) {
  return (
    <div className="hs-field" aria-label="상류사회 영토 전장">
      <div className="hs-field-wall" title="장벽(이동 불가)">
        벽
      </div>
      <div className="hs-field-track">
        {seats.map((seat) =>
          seat.eliminated ? null : (
            <div
              key={seat.id}
              className={`hs-field-seg hs-field-${seat.letter.toLowerCase()}`}
              style={{
                flexGrow: Math.max(seat.widthCm, 0.01),
                flexBasis: 0,
                background: seat.color,
              }}
              title={`${seat.letter} ${seat.name} · ${formatCm(seat.widthCm)} · 확장 ${formatCm(seat.expandCm)}`}
            >
              <span className="hs-field-label">
                {seat.letter} : {formatCm(seat.widthCm)}
              </span>
              <span className="hs-field-dir" aria-hidden>
                {seat.expandDir === "right" ? "→" : seat.expandDir === "left" ? "←" : "↔"}
              </span>
            </div>
          )
        )}
      </div>
      <div className="hs-field-wall" title="장벽(이동 불가)">
        벽
      </div>
    </div>
  );
}

function TerritoryGauge({
  style,
  slices,
  seats,
}: {
  style: HighSocietyBarStyle;
  slices: HighSocietyTerritorySlice[];
  seats: HighSocietySeat[];
}) {
  if (style === "field") {
    return <FieldGauge seats={seats} />;
  }

  if (slices.length === 0) {
    return (
      <div className="hs-top-bar-container" aria-label="영토 점유율">
        <div className="hs-territory-empty">후원 대기 중 · 상류사회</div>
      </div>
    );
  }

  if (style === "lanes" || style === "race") {
    const maxAmount = Math.max(...slices.map((s) => s.amount), 1);
    return (
      <div className="hs-lanes-panel" aria-label="영토 게이지">
        {slices.slice(0, 8).map((slice, i) => {
          const fillPct =
            style === "race"
              ? Math.max(6, Math.round((slice.amount / maxAmount) * 1000) / 10)
              : Math.max(6, slice.pct);
          const solid = laneSolidColor(i);
          const letter = laneLetter(i);
          return (
            <div key={slice.id} className="hs-lane-row">
              <div className="hs-lane-tag" title={slice.name}>
                {letter} · {slice.name}
              </div>
              <div className="hs-lane-track">
                <div
                  className="hs-lane-fill"
                  style={{ width: `${fillPct}%`, background: solid }}
                />
                <span className="hs-lane-fill-label">
                  {letter} : {formatManWon(slice.amount)}
                </span>
              </div>
              <div className="hs-lane-meta">{slice.pct}%</div>
            </div>
          );
        })}
      </div>
    );
  }

  const barClass =
    style === "chevron" ? "hs-top-bar-container hs-bar-chevron" : "hs-top-bar-container";

  return (
    <div className={barClass} aria-label="영토 점유율">
      {slices.map((slice, i) => (
        <div
          key={slice.id}
          className="hs-territory-bar"
          style={{
            width: `${Math.max(slice.pct, slice.pct > 0 ? 4 : 0)}%`,
            background: style === "chevron" ? laneSolidColor(i) : slice.color,
          }}
          title={`${slice.name} ${slice.pct}% · ${formatManWon(slice.amount)}`}
        >
          {slice.pct >= 12 ? (
            <>
              <span className="hs-player-name">{slice.name}</span>
              <span>{slice.pct}%</span>
            </>
          ) : slice.pct >= 6 ? (
            <span>{slice.pct}%</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export default function HighSocietyOverlayPage() {
  const { params: sp, ready: spReady } = useClientOnlySearchParams();
  const userId = getOverlayUserIdFromSearchParams(sp);
  const hostObs = isOverlayBroadcastHost(sp);
  const useTest = (sp.get("test") || "").toLowerCase() === "true";
  const corner = (sp.get("corner") || "right").toLowerCase() === "left" ? "left" : "right";
  const barStyle = parseHighSocietyBarStyle(sp.get("bar") || sp.get("gauge"));
  const split = parseHighSocietySplit(sp.get("bLeft") || sp.get("b"), sp.get("cLeft") || sp.get("c"));

  const { state, ready } = useOverlayRemoteState(userId);
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const members = useMemo(() => {
    if (useTest) return HIGH_SOCIETY_TEST_MEMBERS;
    return state?.members || [];
  }, [state?.members, useTest]);

  const field = useMemo(
    () => buildHighSocietyFieldFromMembers(members, { split }),
    [members, split]
  );

  const { slices, total } = useMemo(() => buildHighSocietyTerritory(members), [members]);

  const zones = useMemo(
    () =>
      barStyle === "field"
        ? buildHighSocietyZones(field.seats)
        : buildHighSocietyZones(slices),
    [barStyle, field.seats, slices]
  );

  const remainingSec = useMemo(() => {
    if (useTest) return 45 * 60 + 30;
    const timer = state?.generalTimer;
    if (!timer) return 0;
    return getEffectiveRemainingTime(timer, nowTick);
  }, [state?.generalTimer, nowTick, useTest]);

  const timerLabel = formatHighSocietyTimer(remainingSec);
  const timerActive = useTest ? true : Boolean(state?.generalTimer?.isActive);

  if (!spReady) return null;
  if (!ready && !useTest) {
    return (
      <main className="hs-overlay-root flex items-start justify-center p-4 text-sm text-white/70">
        상류사회 오버레이 불러오는 중…
      </main>
    );
  }

  const minimapTop =
    barStyle === "lanes" || barStyle === "race"
      ? Math.min(56 + 8 + slices.slice(0, 8).length * 34, 320)
      : barStyle === "field"
        ? 72
        : 60;

  const leader = barStyle === "field" ? field.leader : slices[0] || null;
  const statusTotal =
    barStyle === "field"
      ? field.seats.reduce((s, x) => s + x.donationWon, 0)
      : total;

  return (
    <main className={`hs-overlay-root${hostObs ? " hs-host-obs" : ""}`}>
      <div id="hs-overlay-container">
        {useTest ? <div className="hs-test-badge">TEST</div> : null}

        <TerritoryGauge style={barStyle} slices={slices} seats={field.seats} />

        <aside
          className={`hs-minimap-frame hs-corner-${corner}`}
          style={{ top: minimapTop }}
          aria-label="상류사회 미니맵"
        >
          <div className="hs-timer-bezel">
            {timerActive ? "● " : "○ "}
            ROUND · {timerLabel}
          </div>
          <div className="hs-map-grid">
            {zones.map((zone) => (
              <div
                key={zone.id}
                className={`hs-zone${zone.ownerName ? "" : " hs-zone-empty"}`}
              >
                {zone.ownerName ? (
                  <div className="hs-zone-fill" style={{ background: zone.color }} />
                ) : null}
                <span className="hs-zone-pin">{zone.ownerName || zone.label}</span>
              </div>
            ))}
          </div>
          <div className="hs-status-panel">
            {leader ? (
              <>
                <div>
                  영토 1위 <strong>{"letter" in leader ? `${leader.letter} ` : ""}{leader.name}</strong>
                  {barStyle === "field" && "widthCm" in leader
                    ? ` · ${formatCm(leader.widthCm)}`
                    : ` · ${leader.pct}%`}
                </div>
                <div>라운드 후원 {formatManWon(statusTotal)}</div>
                {barStyle === "field" && field.cushion.length > 0 ? (
                  <div className="hs-cushion">
                    방석: {field.cushion.map((s) => s.letter).join(", ")}
                  </div>
                ) : null}
              </>
            ) : (
              <div>영토 미점유 · 후원을 기다립니다</div>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
