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
}: {
  label: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [fontPx, setFontPx] = useState(16);

  useLayoutEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent || typeof ResizeObserver === "undefined") return;

    const apply = () => {
      const h = parent.clientHeight;
      const w = parent.clientWidth;
      if (h < 1 || w < 1) return;
      const byH = h * 0.56;
      const byW = (w * battleGaugeScoreWidthCqw(Array.from(label).length)) / 100;
      const next = Math.round(Math.max(10, Math.min(36, Math.min(byH, byW))) * 10) / 10;
      setFontPx((prev) => (Math.abs(prev - next) < 0.35 ? prev : next));
    };

    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [label]);

  return (
    <span
      ref={ref}
      className={className}
      style={{
        ...style,
        fontSize: `${fontPx}px`,
        lineHeight: 1,
        maxWidth: "100%",
      }}
    >
      {children ?? label}
    </span>
  );
}
