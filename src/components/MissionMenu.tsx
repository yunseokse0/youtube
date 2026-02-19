import React from "react";
import { MissionItem } from "@/lib/state";

const MissionMenu = ({ missions, fontSize = 16 }: { missions: MissionItem[]; fontSize?: number }) => {
  if (!missions.length) return null;

  return (
    <div
      className="w-80 bg-transparent p-5 rounded-sm animate-slideInRight"
      style={{ fontSize }}
    >
      <div className="text-center mb-4">
        <h2 className="text-amber-400 text-[1.4em] font-black tracking-widest uppercase">
          Special Missions
        </h2>
        <div className="h-1 w-full bg-amber-400 mt-1" />
      </div>

      <ul className="space-y-3">
        {missions.map((item) => (
          <li key={item.id} className="group flex flex-col">
            <div className="flex justify-between items-end">
              <span className="text-white text-[1em] font-bold group-hover:text-amber-300 transition-colors">
                {item.isHot && (
                  <span className="mr-2 text-[0.65em] bg-red-600 text-white px-1 rounded animate-pulse">
                    HOT
                  </span>
                )}
                {item.title}
              </span>
              <span className="text-amber-400 font-mono font-bold text-[1em]">
                {item.price}
              </span>
            </div>
            <div className="border-b border-dashed border-stone-600 w-full mt-1" />
          </li>
        ))}
      </ul>

      <div className="mt-6 text-center">
        <p className="text-stone-500 text-[0.7em] italic">
          All missions are subject to streamer&apos;s condition.
        </p>
      </div>
    </div>
  );
};

export default MissionMenu;
