import React from "react";
import { MissionItem } from "@/lib/state";

const MissionMenu = ({ missions, fontSize = 16 }: { missions: MissionItem[]; fontSize?: number }) => {
  if (!missions.length) return null;

  return (
    <div className="mission-board w-80 rounded-md p-3" style={{ fontSize }}>
      <div className="text-center mb-2">
        <h2 className="text-amber-300 text-[1.15em] font-black tracking-[0.18em] uppercase">
          Special Missions
        </h2>
      </div>

      <ul className="space-y-2">
        {missions.map((item) => (
          <li key={item.id} className="mission-row rounded px-2 py-1">
            <div className="led-track-wrap">
              <div className="led-track">
                <span className="led-item">
                  {item.isHot ? "[HOT] " : ""}
                  {item.title} - {item.price}
                </span>
                <span className="led-item" aria-hidden>
                  {item.isHot ? "[HOT] " : ""}
                  {item.title} - {item.price}
                </span>
                <span className="led-item" aria-hidden>
                  {item.isHot ? "[HOT] " : ""}
                  {item.title} - {item.price}
                </span>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <style jsx>{`
        .mission-board {
          background: rgba(6, 8, 16, 0.84);
          border: 1px solid rgba(250, 204, 21, 0.35);
          box-shadow:
            0 0 0 1px rgba(250, 204, 21, 0.18) inset,
            0 0 16px rgba(250, 204, 21, 0.1);
        }
        .mission-row {
          background: rgba(12, 18, 28, 0.72);
          border: 1px solid rgba(250, 204, 21, 0.24);
        }
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
          color: #fde68a;
          text-shadow: 0 0 6px rgba(253, 230, 138, 0.65);
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
