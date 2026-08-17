"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { battleGaugeScoreWidthCqw } from "@/lib/battle-gauge-fit";

/**
 * 부모(게이지 세그먼트) 실측 높·폭에 맞춰 금액 글자 크기 조절.
 * 막대 높이는 고정이라 fontSize 변경이 레이아웃 피드백 루프를 만들지 않음.
 */
export default function BattleGaugeFitScore({
  label,
  className,
  style,
  children,
  maxFontPx = 22,
}: {
  label: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  /** 막대 높이·폭 실측 후에도 넘치지 않게 상한(px) */
  maxFontPx?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [fontPx, setFontPx] = useState(Math.min(14, maxFontPx));

  useLayoutEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent || typeof ResizeObserver === "undefined") return;

    const apply = () => {
      const h = parent.clientHeight;
      const w = parent.clientWidth;
      if (h < 1 || w < 1) return;
      const byH = h * 0.44;
      const byW = (w * battleGaugeScoreWidthCqw(Array.from(label).length)) / 100;
      const cap = Math.max(9, maxFontPx);
      const next = Math.round(Math.max(9, Math.min(cap, Math.min(byH, byW))) * 10) / 10;
      setFontPx((prev) => (Math.abs(prev - next) < 0.35 ? prev : next));
    };

    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [label, maxFontPx]);

  return (
    <span
      ref={ref}
      className={className}
      style={{
        ...style,
        fontSize: `${fontPx}px`,
        lineHeight: 1,
        maxWidth: "100%",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {children ?? label}
    </span>
  );
}
