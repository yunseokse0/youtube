"use client";

import React, { useState } from "react";

interface InfoTooltipProps {
  text: string;
  className?: string;
  icon?: string;
  side?: "top" | "bottom";
}

/**
 * 💡 어드민 화면 설명 줄글을 깔끔하게 압축하는 호버 툴팁 컴포넌트
 */
export function InfoTooltip({
  text,
  className = "",
  icon = "?",
  side = "top",
}: InfoTooltipProps) {
  const [touchOpen, setTouchOpen] = useState(false);

  return (
    <span
      className={`relative inline-flex items-center align-middle cursor-help select-none ml-1.5 group ${className}`}
      onClick={(e) => {
        e.stopPropagation();
        setTouchOpen((prev) => !prev);
      }}
      title={text}
    >
      <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-white/10 hover:bg-indigo-500/30 text-[10px] font-bold text-neutral-300 hover:text-indigo-200 border border-white/15 hover:border-indigo-400/50 leading-none transition-all shadow-sm">
        {icon}
      </span>
      <span
        className={`pointer-events-none absolute left-1/2 -translate-x-1/2 z-50 w-64 max-w-[280px] p-2.5 rounded-xl bg-neutral-900/95 border border-indigo-400/30 text-[11px] font-normal text-neutral-200 leading-relaxed shadow-2xl backdrop-blur-md transition-opacity duration-150 whitespace-normal text-left ${
          side === "bottom" ? "top-full mt-2" : "bottom-full mb-2"
        } ${touchOpen ? "flex" : "hidden group-hover:flex"}`}
      >
        <span>{text}</span>
        <span
          className={`w-2 h-2 rotate-45 bg-neutral-900 border-indigo-400/30 absolute left-1/2 -translate-x-1/2 ${
            side === "bottom"
              ? "-top-1 border-t border-l"
              : "-bottom-1 border-b border-r"
          }`}
        />
      </span>
    </span>
  );
}

export default InfoTooltip;
