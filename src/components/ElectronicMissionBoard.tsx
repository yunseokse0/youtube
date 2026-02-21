'use client';

import { useState, useEffect } from 'react';
import { MissionItem } from '@/lib/state';

interface ElectronicMissionBoardProps {
  missions: MissionItem[];
  fontSize?: number;
  missionAnchor?: { x: number; y: number };
}

interface Theme {
  frameBg: string;
  panelBg: string;
  textColor: string;
  borderColor: string;
  ledColor: string;
  sideLedColor: string;
  statusColor: string;
}

const themes: { [key: string]: Theme } = {
  blue: {
    frameBg: 'linear-gradient(135deg, #1e3c72, #2a5298)',
    panelBg: '#0a0a0a',
    textColor: '#00ff88',
    borderColor: '#00ff88',
    ledColor: '#00ff88',
    sideLedColor: '#00ff88',
    statusColor: '#00ff88'
  },
  red: {
    frameBg: 'linear-gradient(135deg, #8b0000, #dc143c)',
    panelBg: '#0a0a0a',
    textColor: '#ff4444',
    borderColor: '#ff4444',
    ledColor: '#ff4444',
    sideLedColor: '#ff4444',
    statusColor: '#ff4444'
  },
  green: {
    frameBg: 'linear-gradient(135deg, #006400, #228b22)',
    panelBg: '#0a0a0a',
    textColor: '#44ff44',
    borderColor: '#44ff44',
    ledColor: '#44ff44',
    sideLedColor: '#44ff44',
    statusColor: '#44ff44'
  }
};

export default function ElectronicMissionBoard({ missions, fontSize = 16, missionAnchor }: ElectronicMissionBoardProps) {
  const [position, setPosition] = useState(400);
  const [currentTheme] = useState('blue');
  
  const theme = themes[currentTheme];
  
  // 미션 텍스트 생성
  const missionText = missions.length > 0 
    ? missions.map(mission => 
        mission.isHot ? `🔥 ${mission.title} - ${mission.price}원 🔥` : `${mission.title} - ${mission.price}원`
      ).join('   |   ')
    : '현재 진행중인 미션이 없습니다';
  
  const displayText = `${missionText}   |   ${missionText}`;
  
  // 흐르는 애니메이션
  useEffect(() => {
    const interval = setInterval(() => {
      setPosition(prev => {
        if (prev < -800) {
          return 400;
        }
        return prev - 2;
      });
    }, 50);
    
    return () => clearInterval(interval);
  }, []);
  
  return (
    <div 
      style={{ 
        fontSize,
        position: 'relative',
        width: '100%',
        height: '100%',
        zIndex: 50,
        overflow: 'hidden',
        pointerEvents: 'none'
      }}
    >
      {/* 전광판 프레임 - 설정된 위치에 고정 */}
      <div style={{
        position: 'absolute',
        left: missionAnchor ? `${missionAnchor.x}%` : '50%',
        top: missionAnchor ? `${missionAnchor.y}%` : '50%',
        transform: 'translate(-50%, -50%)',
        background: theme.frameBg,
        padding: '8px',
        borderRadius: '8px',
        boxShadow: '0 8px 20px rgba(0,0,0,0.7)',
        border: `2px solid ${theme.borderColor}`,
        minWidth: '400px',
        maxWidth: '600px'
      }}>
        {/* 내부 LED 패널 */}
        <div style={{
          backgroundColor: theme.panelBg,
          borderRadius: '6px',
          padding: '16px',
          minWidth: '350px',
          minHeight: '120px',
          border: `2px solid ${theme.borderColor}`,
          position: 'relative',
          overflow: 'hidden'
        }}>
          {/* LED 효과 */}
          <div style={{
            position: 'absolute',
            inset: 0,
            background: `linear-gradient(to right, transparent, ${theme.textColor}20, transparent)`,
            animation: 'pulse 2s infinite'
          }} />
          
          {/* 상단 라벨 */}
          <div style={{ marginBottom: '8px', textAlign: 'center' }}>
            <span style={{
              color: theme.textColor,
              fontWeight: 'bold',
              fontSize: '14px',
              letterSpacing: '0.2em',
              animation: 'pulse 2s infinite',
              textShadow: `0 0 8px ${theme.textColor}80`
            }}>
              ■ MISSION BOARD ■
            </span>
          </div>
          
          {/* 흐르는 미션 텍스트 컨테이너 */}
          <div style={{
            position: 'relative',
            height: '80px',
            overflow: 'hidden',
            marginBottom: '8px'
          }}>
            {/* 흐르는 텍스트 */}
            <div style={{
              position: 'absolute',
              left: `${position}px`,
              top: '50%',
              transform: 'translateY(-50%)',
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center'
            }}>
              {/* 메인 디스플레이 */}
              <div style={{
                backgroundColor: theme.panelBg,
                border: `2px solid ${theme.textColor}`,
                borderRadius: '6px',
                padding: '16px',
                minHeight: '60px',
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
                      border: `1px solid ${theme.ledColor}`,
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
                    color: theme.textColor,
                    letterSpacing: '0.1em',
                    textShadow: `0 0 8px ${theme.textColor}80, 0 0 16px ${theme.textColor}40`,
                    filter: 'brightness(1.2)',
                    fontSize: '24px'
                  }}>
                    {displayText}
                    {/* 커서 효과 */}
                    <span style={{ marginLeft: '4px' }}>█</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
          
          {/* 하단 상태 표시줄 */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '12px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{
                color: theme.statusColor,
                animation: 'pulse 2s infinite'
              }}>●</span>
              <span style={{
                color: theme.textColor,
                fontFamily: 'monospace',
                fontSize: '10px'
              }}>
                SYSTEM ONLINE
              </span>
            </div>
            <div style={{
              color: theme.textColor,
              fontFamily: 'monospace',
              fontSize: '10px',
              opacity: 0.8
            }}>
              {missions.length} MISSIONS
            </div>
          </div>
        </div>
        
        {/* 사이드 LED 효과 */}
        <div style={{
          position: 'absolute',
          left: '-12px',
          top: '50%',
          transform: 'translateY(-50%)'
        }}>
          <div style={{
            width: '6px',
            height: '48px',
            backgroundColor: theme.sideLedColor,
            borderRadius: '3px',
            animation: 'pulse 2s infinite',
            boxShadow: `0 0 10px ${theme.sideLedColor}`
          }} />
        </div>
        <div style={{
          position: 'absolute',
          right: '-12px',
          top: '50%',
          transform: 'translateY(-50%)'
        }}>
          <div style={{
            width: '6px',
            height: '48px',
            backgroundColor: theme.sideLedColor,
            borderRadius: '3px',
            animation: 'pulse 2s infinite',
            boxShadow: `0 0 10px ${theme.sideLedColor}`
          }} />
        </div>
      </div>
      
      <style jsx>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
      `}</style>
    </div>
  );
}