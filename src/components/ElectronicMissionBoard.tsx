import React, { useEffect, useState } from "react";
import { MissionItem } from "@/lib/state";

interface Theme {
  name: string;
  frameBg: string;
  panelBg: string;
  borderColor: string;
  textColor: string;
  ledColor: string;
  statusColor: string;
  sideLedColor: string;
}

const themes: Record<string, Theme> = {
  neon: {
    name: 'Neon Green',
    frameBg: 'linear-gradient(to bottom, #374151, #1f2937)',
    panelBg: '#000000',
    borderColor: '#22c55e',
    textColor: '#22c55e',
    ledColor: '#15803d',
    statusColor: '#16a34a',
    sideLedColor: '#ef4444'
  },
  blue: {
    name: 'Neon Blue',
    frameBg: 'linear-gradient(to bottom, #1e3a8a, #1e40af)',
    panelBg: '#000000',
    borderColor: '#3b82f6',
    textColor: '#60a5fa',
    ledColor: '#2563eb',
    statusColor: '#3b82f6',
    sideLedColor: '#f59e0b'
  },
  purple: {
    name: 'Neon Purple',
    frameBg: 'linear-gradient(to bottom, #581c87, #6b21a8)',
    panelBg: '#000000',
    borderColor: '#a855f7',
    textColor: '#c084fc',
    ledColor: '#7c3aed',
    statusColor: '#9333ea',
    sideLedColor: '#fbbf24'
  },
  red: {
    name: 'Neon Red',
    frameBg: 'linear-gradient(to bottom, #7f1d1d, #991b1b)',
    panelBg: '#000000',
    borderColor: '#ef4444',
    textColor: '#f87171',
    ledColor: '#dc2626',
    statusColor: '#ef4444',
    sideLedColor: '#22c55e'
  },
  gold: {
    name: 'Gold',
    frameBg: 'linear-gradient(to bottom, #92400e, #b45309)',
    panelBg: '#000000',
    borderColor: '#f59e0b',
    textColor: '#fbbf24',
    ledColor: '#d97706',
    statusColor: '#f59e0b',
    sideLedColor: '#10b981'
  },
  matrix: {
    name: 'Matrix',
    frameBg: 'linear-gradient(to bottom, #052e16, #064e3b)',
    panelBg: '#000000',
    borderColor: '#10b981',
    textColor: '#34d399',
    ledColor: '#059669',
    statusColor: '#10b981',
    sideLedColor: '#8b5cf6'
  }
};

const ElectronicMissionBoard = ({ missions, fontSize = 16, theme = 'neon' }: { 
  missions: MissionItem[]; 
  fontSize?: number;
  theme?: string;
}) => {
  const [displayText, setDisplayText] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [position, setPosition] = useState(0);

  const currentTheme = themes[theme] || themes.neon;

  useEffect(() => {
    if (!missions.length) return;

    const formatMissionText = (mission: MissionItem) => {
      const hotIcon = mission.isHot ? "🔥" : "";
      return `${hotIcon} ${mission.title} ${mission.price}`;
    };

    const animateText = () => {
      if (missions.length === 0) return;

      const currentMission = missions[currentIndex % missions.length];
      const fullText = formatMissionText(currentMission);
      
      setIsAnimating(true);
      setPosition(window.innerWidth); // 우측에서 시작
      
      // 흐르는 애니메이션
      const flowInterval = setInterval(() => {
        setPosition(prev => {
          const newPos = prev - 2; // 좌측으로 이동
          if (newPos < -400) { // 화면을 완전히 벗어나면
            clearInterval(flowInterval);
            setIsAnimating(false);
            setTimeout(() => {
              setCurrentIndex(prev => prev + 1);
            }, 500);
            return newPos;
          }
          return newPos;
        });
      }, 30);
    };

    const timeout = setTimeout(animateText, 500);
    return () => clearTimeout(timeout);
  }, [currentIndex, missions]);

  if (!missions.length) return null;

  return (
    <div 
      style={{ 
        fontSize,
        position: 'fixed',
        top: '16px',
        left: '0',
        width: '100%',
        zIndex: 50,
        overflow: 'hidden',
        pointerEvents: 'none'
      }}
    >
      {/* 흐르는 텍스트 */}
      <div style={{
        position: 'absolute',
        left: `${position}px`,
        whiteSpace: 'nowrap',
        display: 'flex',
        alignItems: 'center'
      }}>
        {/* 전광판 프레임 - 크기 축소 */}
        <div style={{
          background: currentTheme.frameBg,
          padding: '4px',
          borderRadius: '6px',
          boxShadow: '0 6px 15px rgba(0,0,0,0.5)',
          border: `1px solid ${currentTheme.borderColor}`,
          position: 'relative'
        }}>
          {/* 내부 LED 패널 */}
          <div style={{
            backgroundColor: currentTheme.panelBg,
            borderRadius: '3px',
            padding: '8px',
            minWidth: '250px',
            border: `2px solid ${currentTheme.borderColor}`,
            position: 'relative',
            overflow: 'hidden'
          }}>
            {/* LED 효과 */}
            <div style={{
              position: 'absolute',
              inset: 0,
              background: `linear-gradient(to right, transparent, ${currentTheme.textColor}20, transparent)`,
              animation: 'pulse 2s infinite'
            }} />
            
            {/* 상단 라벨 - 글자 크기 축소 */}
            <div style={{ marginBottom: '4px' }}>
              <span style={{
                color: currentTheme.textColor,
                fontWeight: 'bold',
                fontSize: '10px',
                letterSpacing: '0.1em',
                animation: 'pulse 2s infinite'
              }}>
                ■ MISSION BOARD ■
              </span>
            </div>
            
            {/* 메인 디스플레이 - 크기 축소 */}
            <div style={{
              backgroundColor: currentTheme.panelBg,
              border: `1px solid ${currentTheme.textColor}`,
              borderRadius: '3px',
              padding: '8px',
              minHeight: '40px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative'
            }}>
              {/* LED 그리드 효과 */}
              <div style={{
                position: 'absolute',
                inset: 0,
                opacity: 0.2
              }}>
                {Array.from({ length: 16 }).map((_, i) => (
                  <div key={i} style={{
                    position: 'absolute',
                    width: '25%',
                    height: '25%',
                    border: `1px solid ${currentTheme.ledColor}`,
                    left: `${(i % 4) * 25}%`,
                    top: `${Math.floor(i / 4) * 25}%`
                  }} />
                ))}
              </div>
              
              {/* 텍스트 디스플레이 */}
              <div style={{ position: 'relative', zIndex: 10 }}>
                <span style={{
                  fontFamily: 'monospace',
                  fontWeight: 'bold',
                  color: currentTheme.textColor,
                  letterSpacing: '0.1em',
                  textShadow: `0 0 8px ${currentTheme.textColor}80, 0 0 16px ${currentTheme.textColor}40`,
                  filter: 'brightness(1.2)',
                  fontSize: '14px'
                }}>
                  {displayText}
                  {/* 커서 효과 */}
                  <span style={{ marginLeft: '2px' }}>█</span>
                </span>
              </div>
            </div>
            
            {/* 하단 상태 표시줄 - 크기 축소 */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '4px',
              fontSize: '8px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{
                  color: currentTheme.statusColor,
                  animation: 'pulse 2s infinite'
                }}>●</span>
                <span style={{
                  color: currentTheme.textColor,
                  fontFamily: 'monospace',
                  fontWeight: 'bold'
                }}>ACTIVE</span>
              </div>
              <div style={{ color: currentTheme.statusColor }}>
                {currentIndex + 1} / {missions.length}
              </div>
            </div>
          </div>
          
          {/* 사이드 LED 효과 - 크기 축소 */}
          <div style={{
            position: 'absolute',
            left: '-6px',
            top: '50%',
            transform: 'translateY(-50%)'
          }}>
            <div style={{
              width: '3px',
              height: '24px',
              backgroundColor: currentTheme.sideLedColor,
              borderRadius: '2px',
              animation: 'pulse 2s infinite'
            }} />
          </div>
          <div style={{
            position: 'absolute',
            right: '-6px',
            top: '50%',
            transform: 'translateY(-50%)'
          }}>
            <div style={{
              width: '3px',
              height: '24px',
              backgroundColor: currentTheme.sideLedColor,
              borderRadius: '2px',
              animation: 'pulse 2s infinite'
            }} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ElectronicMissionBoard;