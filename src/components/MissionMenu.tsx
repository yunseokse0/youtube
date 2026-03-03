import React from "react";
import { MissionItem } from "@/lib/state";

type MissionThemeVariant = "default" | "excel" | "neon" | "retro" | "minimal" | "rpg" | "pastel" | "neonExcel";

const MISSION_THEME_STYLES: Record<MissionThemeVariant, {
  boardBg: string;
  boardBorder: string;
  boardShadow: string;
  titleColor: string;
  rowBg: string;
  rowBorder: string;
  itemColor: string;
  itemShadow: string;
}> = {
  default: {
    boardBg: "rgba(6, 8, 16, 0.84)",
    boardBorder: "rgba(250, 204, 21, 0.35)",
    boardShadow: "0 0 0 1px rgba(250, 204, 21, 0.18) inset, 0 0 16px rgba(250, 204, 21, 0.1)",
    titleColor: "#fcd34d",
    rowBg: "rgba(12, 18, 28, 0.72)",
    rowBorder: "rgba(250, 204, 21, 0.24)",
    itemColor: "#fde68a",
    itemShadow: "0 0 6px rgba(253, 230, 138, 0.65)",
  },
  excel: {
    boardBg: "rgba(255, 255, 255, 0.96)",
    boardBorder: "rgba(33, 115, 70, 0.65)",
    boardShadow: "0 0 0 1px rgba(33, 115, 70, 0.25) inset",
    titleColor: "#217346",
    rowBg: "rgba(233, 245, 238, 0.96)",
    rowBorder: "rgba(33, 115, 70, 0.35)",
    itemColor: "#1e3a2e",
    itemShadow: "none",
  },
  neon: {
    boardBg: "rgba(4, 8, 18, 0.86)",
    boardBorder: "rgba(0, 255, 255, 0.45)",
    boardShadow: "0 0 0 1px rgba(0,255,255,0.25) inset, 0 0 14px rgba(0,255,255,0.25)",
    titleColor: "#7df9ff",
    rowBg: "rgba(14, 20, 40, 0.78)",
    rowBorder: "rgba(255, 0, 255, 0.35)",
    itemColor: "#ffcc4d",
    itemShadow: "0 0 8px rgba(255, 204, 77, 0.8)",
  },
  retro: {
    boardBg: "rgba(8, 12, 8, 0.9)",
    boardBorder: "rgba(74, 222, 128, 0.45)",
    boardShadow: "0 0 0 1px rgba(74, 222, 128, 0.2) inset",
    titleColor: "#86efac",
    rowBg: "rgba(10, 20, 12, 0.8)",
    rowBorder: "rgba(34, 197, 94, 0.35)",
    itemColor: "#bbf7d0",
    itemShadow: "none",
  },
  minimal: {
    boardBg: "rgba(15, 15, 18, 0.62)",
    boardBorder: "rgba(255, 255, 255, 0.2)",
    boardShadow: "none",
    titleColor: "#e5e7eb",
    rowBg: "rgba(28, 28, 32, 0.55)",
    rowBorder: "rgba(255, 255, 255, 0.14)",
    itemColor: "#f3f4f6",
    itemShadow: "none",
  },
  rpg: {
    boardBg: "rgba(27, 20, 8, 0.88)",
    boardBorder: "rgba(251, 191, 36, 0.45)",
    boardShadow: "0 0 0 1px rgba(251,191,36,0.2) inset, 0 0 14px rgba(245,158,11,0.2)",
    titleColor: "#facc15",
    rowBg: "rgba(51, 34, 12, 0.78)",
    rowBorder: "rgba(245, 158, 11, 0.35)",
    itemColor: "#fde68a",
    itemShadow: "0 0 5px rgba(250, 204, 21, 0.55)",
  },
  pastel: {
    boardBg: "rgba(95, 66, 132, 0.6)",
    boardBorder: "rgba(244, 114, 182, 0.45)",
    boardShadow: "0 0 0 1px rgba(244,114,182,0.2) inset",
    titleColor: "#fbcfe8",
    rowBg: "rgba(111, 76, 153, 0.58)",
    rowBorder: "rgba(196, 181, 253, 0.38)",
    itemColor: "#fdf2f8",
    itemShadow: "0 0 6px rgba(233, 213, 255, 0.45)",
  },
  neonExcel: {
    boardBg: "rgba(4, 13, 20, 0.88)",
    boardBorder: "rgba(34, 211, 238, 0.5)",
    boardShadow: "0 0 0 1px rgba(34,211,238,0.25) inset, 0 0 14px rgba(34,211,238,0.2)",
    titleColor: "#67e8f9",
    rowBg: "rgba(9, 23, 35, 0.78)",
    rowBorder: "rgba(56, 189, 248, 0.35)",
    itemColor: "#a5f3fc",
    itemShadow: "0 0 6px rgba(103, 232, 249, 0.5)",
  },
};

const MissionMenu = ({ missions, fontSize = 16, themeVariant = "default" }: { missions: MissionItem[]; fontSize?: number; themeVariant?: MissionThemeVariant }) => {
  if (!missions.length) return null;
  const theme = MISSION_THEME_STYLES[themeVariant] || MISSION_THEME_STYLES.default;

  return (
    <div
      className="mission-board w-80 rounded-md p-3"
      style={{
        fontSize,
        background: theme.boardBg,
        border: `1px solid ${theme.boardBorder}`,
        boxShadow: theme.boardShadow,
      }}
    >
      <div className="text-center mb-2">
        <h2 className="text-[1.15em] font-black tracking-[0.18em] uppercase" style={{ color: theme.titleColor }}>
          Special Missions
        </h2>
      </div>

      <ul className="space-y-2">
        {missions.map((item) => (
          <li key={item.id} className="mission-row rounded px-2 py-1" style={{ background: theme.rowBg, border: `1px solid ${theme.rowBorder}` }}>
            <div className="led-track-wrap">
              <div className="led-track">
                <span className="led-item" style={{ color: theme.itemColor, textShadow: theme.itemShadow }}>
                  {item.isHot ? "[HOT] " : ""}
                  {item.title} - {item.price}
                </span>
                <span className="led-item" aria-hidden style={{ color: theme.itemColor, textShadow: theme.itemShadow }}>
                  {item.isHot ? "[HOT] " : ""}
                  {item.title} - {item.price}
                </span>
                <span className="led-item" aria-hidden style={{ color: theme.itemColor, textShadow: theme.itemShadow }}>
                  {item.isHot ? "[HOT] " : ""}
                  {item.title} - {item.price}
                </span>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <style jsx>{`
        .led-track-wrap {
          overflow: hidden;
          white-space: nowrap;
        }
        .led-track {
          display: inline-flex;
          min-width: 100%;
          animation: mission-marquee 16s linear infinite;
        }
        .led-item {
          font-weight: 800;
          letter-spacing: 0.04em;
          margin-right: 2.25rem;
        }
        @keyframes mission-marquee {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(-33.333%);
          }
        }
      `}</style>
    </div>
  );
};

export default MissionMenu;
