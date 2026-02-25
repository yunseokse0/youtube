"use client";
import { useEffect, useMemo, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { AppState, totalAccount, Member, loadState } from "@/lib/state";

function useStorageState(): AppState {
  const [state, setState] = useState<AppState>({ members: [], donors: [], forbiddenWords: [], updatedAt: Date.now() });

  useEffect(() => {
    loadState().then(setState);
    const id = setInterval(() => loadState().then(setState), 1000);
    return () => clearInterval(id);
  }, []);

  return state;
}

// 금액 포맷팅 함수
function formatCurrency(amount: number, showCurrency: boolean = true): string {
  const formatted = amount.toLocaleString('ko-KR');
  return showCurrency ? `${formatted}원` : formatted;
}

// 멤버별 색상 정의
const memberColors = {
  yellow: { primary: "#FFD700", secondary: "#FFA500", glow: "#FFD700", bg: "rgba(255, 215, 0, 0.1)" },
  purple: { primary: "#9370DB", secondary: "#8A2BE2", glow: "#9370DB", bg: "rgba(147, 112, 219, 0.1)" },
  pink: { primary: "#FF69B4", secondary: "#FF1493", glow: "#FF69B4", bg: "rgba(255, 105, 180, 0.1)" },
  blue: { primary: "#00BFFF", secondary: "#1E90FF", glow: "#00BFFF", bg: "rgba(0, 191, 255, 0.1)" },
  green: { primary: "#32CD32", secondary: "#228B22", glow: "#32CD32", bg: "rgba(50, 205, 50, 0.1)" },
  red: { primary: "#FF6347", secondary: "#DC143C", glow: "#FF6347", bg: "rgba(255, 99, 71, 0.1)" },
  orange: { primary: "#FFA500", secondary: "#FF8C00", glow: "#FFA500", bg: "rgba(255, 165, 0, 0.1)" },
  cyan: { primary: "#00FFFF", secondary: "#00CED1", glow: "#00FFFF", bg: "rgba(0, 255, 255, 0.1)" }
};

function OverlayContent() {
  const searchParams = useSearchParams();
  const state = useStorageState();

  const themeId = searchParams.get("theme") || "neon";
  const scale = parseFloat(searchParams.get("scale") || "1");
  const showCurrency = searchParams.get("showCurrency") !== "false";
  const showPersonalGoals = searchParams.get("showPersonalGoals") !== "false";
  const showTotal = searchParams.get("showTotal") !== "false";
  const showDonors = searchParams.get("showDonors") !== "false";

  // 멤버 정렬 (전체 총합 기준, 동일 금액은 updatedAt 기준)
  const sortedMembers = useMemo(() => {
    return [...state.members]
      .map(member => ({
        ...member,
        totalAmount: member.account + member.toon,
        updatedAt: member.updatedAt || Date.now()
      }))
      .sort((a, b) => {
        if (b.totalAmount !== a.totalAmount) {
          return b.totalAmount - a.totalAmount;
        }
        return (a.updatedAt || 0) - (b.updatedAt || 0);
      });
  }, [state.members]);

  // 총합 계산
  const totalAmount = useMemo(() => totalAccount(state), [state]);
  const totalAccountSum = useMemo(() => state.members.reduce((sum, m) => sum + m.account, 0), [state.members]);
  const totalToonSum = useMemo(() => state.members.reduce((sum, m) => sum + m.toon, 0), [state.members]);

  // 색상 할당
  const getMemberColor = (index: number) => {
    const colors = Object.keys(memberColors);
    return memberColors[colors[index % colors.length] as keyof typeof memberColors];
  };

  return (
    <div
      className="fixed inset-0 pointer-events-none font-sans"
      style={{ 
        transform: `scale(${scale})`, 
        transformOrigin: "top left",
        background: "transparent"
      }}
    >
      {/* 메인 레이아웃 - 좌측 멤버 카드, 우측 후원자 리스트 */}
      <div className="flex h-full p-6 space-x-6">
        
        {/* 좌측: 멤버 카드 영역 */}
        <div className="flex-1 space-y-4">
          
          {/* 총합 정보 패널 */}
          {showTotal && (
            <motion.div 
              className="glass-panel p-6 mb-6"
              initial={{ opacity: 0, y: -30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
            >
              <motion.div 
                className="text-3xl font-bold text-center text-yellow-400"
                style={{ 
                  textShadow: "0 0 20px #FFD700, 0 0 40px #FFD700, 0 0 60px #FFD700"
                }}
                animate={{ scale: [1, 1.02, 1] }}
                transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
              >
                {formatCurrency(totalAmount, showCurrency)}
              </motion.div>
              <div className="text-center text-neutral-300 mt-2">총 후원금</div>
              
              {/* 계좌/투네 합계 */}
              <div className="grid grid-cols-2 gap-4 mt-4">
                <div className="text-center">
                  <div className="text-lg font-semibold text-green-400">
                    {formatCurrency(totalAccountSum, showCurrency)}
                  </div>
                  <div className="text-sm text-neutral-400">계좌 총합</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-semibold text-purple-400">
                    {formatCurrency(totalToonSum, showCurrency)}
                  </div>
                  <div className="text-sm text-neutral-400">투네 총합</div>
                </div>
              </div>
            </motion.div>
          )}

          {/* 멤버 카드 리스트 */}
          <AnimatePresence mode="popLayout">
            {sortedMembers.map((member, index) => {
              const color = getMemberColor(index);
              const total = member.account + member.toon;
              const percentage = member.personalGoal ? Math.min((total / member.personalGoal) * 100, 100) : 0;
              const remaining = member.personalGoal ? Math.max(member.personalGoal - total, 0) : 0;
              
              return (
                <motion.div
                  key={member.id}
                  layout
                  layoutId={member.id}
                  initial={{ opacity: 0, y: 50, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -50, scale: 0.9 }}
                  transition={{ 
                    duration: 0.6, 
                    type: "spring",
                    stiffness: 100,
                    damping: 15
                  }}
                  className="glass-panel p-5 border-l-4"
                  style={{ 
                    borderLeftColor: color.primary,
                    background: `linear-gradient(135deg, rgba(0,0,0,0.4), ${color.bg})`
                  }}
                >
                  {/* 멤버 헤더: 순위 + 직급 + 이름 */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center space-x-3">
                      <motion.div 
                        className="rank-badge"
                        style={{ 
                          background: `linear-gradient(45deg, ${color.primary}, ${color.secondary})`,
                          boxShadow: `0 0 15px ${color.glow}`
                        }}
                        whileHover={{ scale: 1.1 }}
                        transition={{ type: "spring", stiffness: 300 }}
                      >
                        {index + 1}
                      </motion.div>
                      {member.rank && (
                        <span 
                          className="rank-text px-3 py-1 rounded-full text-sm font-semibold"
                          style={{ 
                            background: color.bg,
                            color: color.primary,
                            border: `1px solid ${color.primary}`,
                            textShadow: `0 0 10px ${color.glow}`
                          }}
                        >
                          {member.rank}
                        </span>
                      )}
                      <motion.h3 
                        className="text-xl font-bold member-name"
                        style={{ 
                          color: color.primary,
                          textShadow: `0 0 15px ${color.glow}, 0 0 30px ${color.glow}, 0 0 45px ${color.glow}`
                        }}
                        whileHover={{ scale: 1.05 }}
                        transition={{ type: "spring", stiffness: 300 }}
                      >
                        {member.name}
                      </motion.h3>
                    </div>
                    
                    {/* 전체 총합 */}
                    <motion.div 
                      className="text-xl font-bold"
                      key={total}
                      initial={{ scale: 1.2, color: "#FFD700" }}
                      animate={{ scale: 1, color: "#FFFFFF" }}
                      transition={{ duration: 0.4, type: "spring" }}
                      style={{ textShadow: "0 0 10px rgba(255,255,255,0.5)" }}
                    >
                      {formatCurrency(total, showCurrency)}
                    </motion.div>
                  </div>

                  {/* 금액 세부 정보 */}
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div className="amount-box">
                      <div className="text-sm text-neutral-400">계좌</div>
                      <motion.div 
                        className="text-lg font-semibold text-green-400"
                        key={member.account}
                        initial={{ scale: 1.1 }}
                        animate={{ scale: 1 }}
                        transition={{ duration: 0.3 }}
                      >
                        {formatCurrency(member.account, showCurrency)}
                      </motion.div>
                    </div>
                    <div className="amount-box">
                      <div className="text-sm text-neutral-400">투네</div>
                      <motion.div 
                        className="text-lg font-semibold text-purple-400"
                        key={member.toon}
                        initial={{ scale: 1.1 }}
                        animate={{ scale: 1 }}
                        transition={{ duration: 0.3 }}
                      >
                        {formatCurrency(member.toon, showCurrency)}
                      </motion.div>
                    </div>
                  </div>

                  {/* 게이지 바 */}
                  {showPersonalGoals && member.personalGoal && member.personalGoal > 0 && (
                    <div className="space-y-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-neutral-400">목표 달성률</span>
                        <motion.span 
                          className="font-bold"
                          style={{ color: color.primary }}
                          key={percentage}
                          initial={{ scale: 1.3 }}
                          animate={{ scale: 1 }}
                          transition={{ duration: 0.4, type: "spring" }}
                        >
                          {percentage.toFixed(1)}%
                        </motion.span>
                      </div>
                      
                      <div className="gauge-container">
                        <div className="gauge-bar-bg">
                          <motion.div 
                            className="gauge-bar-fill"
                            initial={{ width: 0 }}
                            animate={{ width: `${percentage}%` }}
                            transition={{ 
                              duration: 1.2, 
                              ease: "easeOut",
                              delay: 0.2
                            }}
                            style={{
                              background: `linear-gradient(90deg, ${color.primary}, ${color.secondary})`,
                              boxShadow: `0 0 20px ${color.glow}, inset 0 0 10px rgba(255,255,255,0.3)`
                            }}
                          />
                        </div>
                      </div>
                      
                      <div className="text-center text-sm text-neutral-400">
                        남은 금액: {formatCurrency(remaining, showCurrency)}
                      </div>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {/* 우측: 후원자 리스트 */}
        {showDonors && (
          <motion.div 
            className="w-80 space-y-4"
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.3 }}
          >
            <div className="glass-panel p-4">
              <h3 className="text-lg font-bold text-center mb-4" style={{ 
                color: "#FFD700",
                textShadow: "0 0 15px #FFD700, 0 0 30px #FFD700"
              }}>
                🎉 Big Hand
              </h3>
              
              <div className="space-y-2 max-h-96 overflow-y-auto">
                <AnimatePresence>
                  {state.donors
                    .sort((a, b) => b.at - a.at)
                    .slice(0, 20)
                    .map((donor, index) => (
                      <motion.div
                        key={donor.id}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        transition={{ duration: 0.4, delay: index * 0.05 }}
                        className="flex justify-between items-center p-2 rounded-lg bg-black bg-opacity-20"
                      >
                        <span className="font-semibold truncate" style={{
                          textShadow: "0 0 8px rgba(255,255,255,0.3)"
                        }}>
                          {donor.name}
                        </span>
                        <span className="font-bold text-yellow-400" style={{
                          textShadow: "0 0 8px rgba(255,215,0,0.5)"
                        }}>
                          {formatCurrency(donor.amount, showCurrency)}
                        </span>
                      </motion.div>
                    ))
                  }
                </AnimatePresence>
                
                {state.donors.length === 0 && (
                  <div className="text-center text-neutral-500 py-8">
                    아직 후원이 없습니다
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </div>

      <style jsx>{`
        .glass-panel {
          background: rgba(0, 0, 0, 0.25);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 16px;
          box-shadow: 
            0 8px 32px rgba(0, 0, 0, 0.3),
            inset 0 1px 0 rgba(255, 255, 255, 0.1);
        }

        .rank-badge {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
          font-size: 14px;
          color: white;
          text-shadow: 0 1px 2px rgba(0,0,0,0.5);
        }

        .rank-text {
          font-size: 12px;
          font-weight: 600;
        }

        .member-name {
          font-size: 20px;
          font-weight: 800;
          letter-spacing: 0.8px;
        }

        .amount-box {
          background: rgba(0, 0, 0, 0.3);
          padding: 12px;
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .gauge-container {
          position: relative;
          width: 100%;
        }

        .gauge-bar-bg {
          width: 100%;
          height: 28px;
          background: rgba(0, 0, 0, 0.6);
          border-radius: 14px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          overflow: hidden;
          position: relative;
          box-shadow: inset 0 2px 4px rgba(0,0,0,0.5);
        }

        .gauge-bar-fill {
          height: 100%;
          border-radius: 14px;
          position: relative;
          transition: width 0.8s ease-out;
        }

        /* 스크롤바 스타일 */
        .overflow-y-auto::-webkit-scrollbar {
          width: 6px;
        }

        .overflow-y-auto::-webkit-scrollbar-track {
          background: rgba(0, 0, 0, 0.2);
          border-radius: 3px;
        }

        .overflow-y-auto::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.3);
          border-radius: 3px;
        }

        .overflow-y-auto::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.5);
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