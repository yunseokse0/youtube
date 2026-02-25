"use client";
import { useEffect, useMemo, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AppState, totalAccount, Member, loadState } from "@/lib/state";
import ElectronicMissionBoard from "@/components/ElectronicMissionBoard";

function useStorageState(): AppState {
  const [state, setState] = useState<AppState>({ members: [], donors: [], forbiddenWords: [], updatedAt: Date.now() });

  useEffect(() => {
    loadState().then(setState);
    const id = setInterval(() => loadState().then(setState), 1000);
    return () => clearInterval(id);
  }, []);

  return state;
}

function OverlayContent() {
  const searchParams = useSearchParams();
  const state = useStorageState();

  const themeId = searchParams.get("theme") || "excel";
  const scale = parseFloat(searchParams.get("scale") || "1");
  const memberSize = parseInt(searchParams.get("memberSize") || "24", 10);
  const totalSize = parseInt(searchParams.get("totalSize") || "32", 10);
  const dense = searchParams.get("dense") === "true";
  const anchor = searchParams.get("anchor") || "top-right";
  const sumAnchor = searchParams.get("sumAnchor") || "bottom-left";
  const sumFree = searchParams.get("sumFree") === "true";
  const sumX = parseInt(searchParams.get("sumX") || "10", 10);
  const sumY = parseInt(searchParams.get("sumY") || "10", 10);
  const showMembers = searchParams.get("showMembers") !== "false";
  const showTotal = searchParams.get("showTotal") !== "false";
  const showGoal = searchParams.get("showGoal") === "true";
  const showTicker = searchParams.get("showTicker") === "true";
  const showTimer = searchParams.get("showTimer") === "true";
  const showMission = searchParams.get("showMission") === "true";

  const total = useMemo(() => totalAccount(state), [state]);

  const missions = useMemo(() => {
    return state.members.flatMap((m) =>
      (m.missions || []).map((mission, index) => ({
        id: `${m.id}-${mission}-${index}`,
        title: `${mission} (${m.name})`,
        price: 0,
        isHot: false,
      }))
    );
  }, [state.members]);

  const positionClasses: Record<string, string> = {
    "top-left": "top-4 left-4",
    "top-right": "top-4 right-4",
    "bottom-left": "bottom-4 left-4",
    "bottom-right": "bottom-4 right-4",
    "top-center": "top-4 left-1/2 -translate-x-1/2",
    "bottom-center": "bottom-4 left-1/2 -translate-x-1/2",
  };

  const sumPositionClasses: Record<string, string> = {
    "top-left": "top-4 left-4",
    "top-right": "top-4 right-4",
    "bottom-left": "bottom-4 left-4",
    "bottom-right": "bottom-4 right-4",
    "top-center": "top-4 left-1/2 -translate-x-1/2",
    "bottom-center": "bottom-4 left-1/2 -translate-x-1/2",
  };

  return (
    <div
      className={`fixed inset-0 pointer-events-none text-white font-sans ${
        themeId === "neon" ? "bg-black" : themeId === "retro" ? "bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900" : "bg-transparent"
      }`}
      style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}
    >
      {/* 멤버 목록 */}
      {showMembers && (
        <div className={`absolute ${positionClasses[anchor]} space-y-2 pointer-events-auto`}>
          {state.members.map((member) => (
            <div
              key={member.id}
              className={`glass p-3 rounded-lg border border-white/20 ${
                dense ? "py-2" : "py-3"
              }`}
            >
              <div className="flex justify-between items-center">
                <span className={`font-semibold ${dense ? "text-sm" : "text-base"}`}>
                  {member.name}
                </span>
                <span className={`font-bold text-emerald-400 ${memberSize === 24 ? "text-lg" : `text-[${memberSize}px]`}`}>
                  {member.account.toLocaleString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 총합 */}
      {showTotal && (
        <div
          className={`absolute ${
            sumFree
              ? `absolute`
              : sumPositionClasses[sumAnchor]
          } glass p-4 rounded-lg border border-white/20 pointer-events-auto`}
          style={
            sumFree
              ? {
                  top: `${sumY}px`,
                  left: `${sumX}px`,
                }
              : {}
          }
        >
          <div className="text-center">
            <div className={`font-bold ${totalSize === 32 ? "text-2xl" : `text-[${totalSize}px]`} text-yellow-400`}>
              {total.toLocaleString()}
            </div>
            <div className="text-sm text-neutral-300">총합</div>
          </div>
        </div>
      )}

      {/* 목표 */}
      {showGoal && (
        <div className={`absolute bottom-4 left-1/2 -translate-x-1/2 glass p-4 rounded-lg border border-white/20 pointer-events-auto`}>
          <div className="text-center">
            <div className="text-lg font-bold text-blue-400">목표: 1,000,000</div>
            <div className="w-64 h-4 bg-neutral-700 rounded-full mt-2">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full"
                style={{ width: `${Math.min((total / 1000000) * 100, 100)}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* 미션 보드 */}
      {showMission && missions.length > 0 && (
        <div className={`absolute top-1/2 left-4 -translate-y-1/2 pointer-events-auto`}>
          <ElectronicMissionBoard missions={missions} fontSize={memberSize} themeName={themeId} />
        </div>
      )}

      {/* Ticker */}
      {showTicker && state.donors.length > 0 && (
        <div className="absolute bottom-4 left-0 right-0 overflow-hidden pointer-events-auto">
          <div className="animate-ticker whitespace-nowrap">
            {state.donors.map((donor) => (
              <span key={donor.id} className="inline-block mx-4">
                <span className="text-emerald-400 font-semibold">{donor.name}</span>
                <span className="mx-2">•</span>
                <span className="text-yellow-400">{donor.amount.toLocaleString()}원</span>
                {donor.message && (
                  <>
                    <span className="mx-2">•</span>
                    <span className="text-neutral-300">{donor.message}</span>
                  </>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Timer */}
      {showTimer && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 glass p-3 rounded-lg border border-white/20 pointer-events-auto">
          <div className="text-center">
            <div className="text-lg font-bold text-red-400">00:00:00</div>
            <div className="text-sm text-neutral-300">방송 시간</div>
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes ticker {
          0% {
            transform: translateX(100%);
          }
          100% {
            transform: translateX(-100%);
          }
        }
        .animate-ticker {
          animation: ticker 30s linear infinite;
        }
        .glass {
          background: rgba(0, 0, 0, 0.3);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
      `}</style>
    </div>
  );
}

export default function OverlayPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <OverlayContent />
    </Suspense>
  );
}