'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { OverlayCard } from '@/components/OverlayCard';
import { AppState } from '@/lib/state';
import { sendSSEUpdate, useSSEConnection } from '@/lib/sse-client';
import { nanoid } from 'nanoid';
import { createModuleLogger } from '@/lib/logger';

export type OverlayElementPosition = {
  x: string;
  y: string;
  width?: string;
  height?: string;
  anchor?: string;
};

export type OverlayPreset = {
  id: string;
  name: string;
  scale: string;
  memberSize: string;
  totalSize: string;
  dense: boolean;
  anchor: string;
  sumAnchor: string;
  sumFree: boolean;
  sumX: string;
  sumY: string;
  theme: string;
  showMembers: boolean;
  showTotal: boolean;
  showGoal: boolean;
  goal: string;
  goalLabel: string;
  goalWidth: string;
  goalAnchor: string;
  showTicker: boolean;
  showTimer: boolean;
  timerStart: number | null;
  timerAnchor: string;
  showMission: boolean;
  missionAnchor: string;
  // 개별 요소 위치 설정
  memberPosition?: OverlayElementPosition;
  totalPosition?: OverlayElementPosition;
  goalPosition?: OverlayElementPosition;
  tickerPosition?: OverlayElementPosition;
  timerPosition?: OverlayElementPosition;
  missionPosition?: OverlayElementPosition;
};

const convertToOverlayPreset = (preset: any): OverlayPreset => ({
  id: preset.id || nanoid(),
  name: preset.name || '새 프리셋',
  scale: String(preset.scale || '1'),
  memberSize: String(preset.memberSize || '24'),
  totalSize: String(preset.totalSize || '64'),
  dense: Boolean(preset.dense || false),
  anchor: preset.anchor || 'tl',
  sumAnchor: preset.sumAnchor || 'bc',
  sumFree: Boolean(preset.sumFree || false),
  sumX: String(preset.sumX || '50'),
  sumY: String(preset.sumY || '90'),
  theme: preset.theme || 'default',
  showMembers: Boolean(preset.showMembers !== undefined ? preset.showMembers : true),
  showTotal: Boolean(preset.showTotal !== undefined ? preset.showTotal : true),
  showGoal: Boolean(preset.showGoal || false),
  goal: String(preset.goal || '0'),
  goalLabel: preset.goalLabel || '목표 금액',
  goalWidth: String(preset.goalWidth || '400'),
  goalAnchor: preset.goalAnchor || 'bc',
  showTicker: Boolean(preset.showTicker || false),
  showTimer: Boolean(preset.showTimer || false),
  timerStart: preset.timerStart || null,
  timerAnchor: preset.timerAnchor || 'tr',
  showMission: Boolean(preset.showMission || false),
  missionAnchor: preset.missionAnchor || 'br',
  // 개별 요소 위치 설정
  memberPosition: preset.memberPosition || undefined,
  totalPosition: preset.totalPosition || undefined,
  goalPosition: preset.goalPosition || undefined,
  tickerPosition: preset.tickerPosition || undefined,
  timerPosition: preset.timerPosition || undefined,
  missionPosition: preset.missionPosition || undefined,
});

const PRESET_TEMPLATES = [
  {
    name: "📊 기본형",
    description: "멤버 목록과 총합 표시",
    preset: {
      name: "기본 오버레이",
      theme: "default",
      showMembers: true,
      showTotal: true,
      showGoal: false,
      showTicker: false,
      showTimer: false,
      showMission: false,
      scale: "1",
      memberSize: 16,
      totalSize: 18,
      dense: false,
      anchor: "br",
      sumAnchor: "bc",
      goal: "0",
      goalLabel: "목표 금액",
      goalWidth: "400",
      goalAnchor: "bc",
      missionAnchor: "br",
      timerAnchor: "tr",
      timerStart: null,
      sumFree: false,
      sumX: "50",
      sumY: "90"
    }
  },
  {
    name: "🎯 목표형",
    description: "후원 목표 금액 표시",
    preset: {
      name: "목표 오버레이",
      theme: "default",
      showMembers: true,
      showTotal: true,
      showGoal: true,
      showTicker: false,
      showTimer: false,
      showMission: false,
      scale: "1",
      memberSize: 16,
      totalSize: 18,
      dense: false,
      anchor: "br",
      sumAnchor: "bc",
      goal: "500000",
      goalLabel: "후원 목표",
      goalWidth: "400",
      goalAnchor: "bc",
      missionAnchor: "br",
      timerAnchor: "tr",
      timerStart: null,
      sumFree: false,
      sumX: "50",
      sumY: "90"
    }
  },
  {
    name: "✨ 미니멀",
    description: "간단하고 깔끔한 디자인",
    preset: {
      name: "미니멀 오버레이",
      theme: "minimal",
      showMembers: false,
      showTotal: true,
      showGoal: false,
      showTicker: false,
      showTimer: false,
      showMission: false,
      scale: "1",
      memberSize: 14,
      totalSize: 16,
      dense: false,
      anchor: "bc",
      sumAnchor: "bc",
      goal: "0",
      goalLabel: "목표 금액",
      goalWidth: "400",
      goalAnchor: "bc",
      missionAnchor: "br",
      timerAnchor: "tr",
      timerStart: null,
      sumFree: false,
      sumX: "50",
      sumY: "90"
    }
  },
  {
    name: "🎮 게임",
    description: "RPG 게임 스타일",
    preset: {
      name: "게임 오버레이",
      theme: "rpg",
      showMembers: true,
      showTotal: true,
      showGoal: true,
      showTicker: false,
      showTimer: false,
      showMission: true,
      scale: "1",
      memberSize: 16,
      totalSize: 18,
      dense: false,
      anchor: "br",
      sumAnchor: "bc",
      goal: "1000000",
      goalLabel: "모험 자금",
      goalWidth: "500",
      goalAnchor: "bc",
      missionAnchor: "br",
      timerAnchor: "tr",
      timerStart: null,
      sumFree: false,
      sumX: "50",
      sumY: "90"
    }
  }
];

const logger = createModuleLogger('Admin');

export default function AdminPage() {
  const [state, setState] = useState<AppState | null>(null);
  const [presets, setPresets] = useState<OverlayPreset[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [lastUpdateTime, setLastUpdateTime] = useState<Date | null>(null);
  const [updateCount, setUpdateCount] = useState(0);
  const [connected, setConnected] = useState(false);
  
  // 상태 로드
  useEffect(() => {
    fetch('/api/state?user=finalent', { credentials: "include" })
      .then(r => r.json())
      .then(data => {
        setState(data);
        setPresets(data.overlaySettings?.presets || []);
        logger.info('상태 로드 성공', { presetsCount: data.overlaySettings?.presets?.length || 0 });
      })
      .catch(error => {
        logger.error('상태 로드 실패', error);
      });
  }, []);

  // SSE 연결 및 성능 측정
  useSSEConnection((data) => {
    setConnected(true);
    setLastUpdateTime(new Date());
    setUpdateCount(prev => prev + 1);
    logger.debug('SSE 메시지 수신', data);
  });

  // 연결 상태 모니터링
  useEffect(() => {
    const interval = setInterval(() => {
      // 마지막 업데이트로부터 5초가 지나면 연결 끊김으로 간주
      if (lastUpdateTime && Date.now() - lastUpdateTime.getTime() > 5000) {
        setConnected(false);
      }
    }, 1000);
    
    return () => clearInterval(interval);
  }, [lastUpdateTime]);

  // 프리셋 저장
  const savePresets = async (newPresets: OverlayPreset[]) => {
    if (!state) return;
    
    const overlaySettings = state.overlaySettings || {
      scale: 1, memberSize: 24, totalSize: 64, dense: false,
      anchor: "tl", sumAnchor: "bc", sumFree: false, sumX: 50, sumY: 90,
      theme: "default", showMembers: true, showTotal: true, showGoal: false,
      goal: 0, goalLabel: "목표 금액", goalWidth: 400, goalAnchor: "bc",
      showTicker: false, showTimer: false, timerStart: null, timerAnchor: "tr",
      showMission: false, missionAnchor: "br"
    };
    
    const updatedState = { 
      ...state, 
      overlaySettings: { 
        ...overlaySettings,
        presets: newPresets 
      } 
    };
    
    try {
      const response = await fetch('/api/state?user=finalent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedState),
        credentials: "include",
      });
      
      if (response.ok) {
        setState(updatedState);
        sendSSEUpdate({ type: 'overlay_update', ...updatedState });
      }
    } catch (error) {
      logger.error('프리셋 저장 실패', error);
    }
  };

  // 프리셋 추가
  const addPreset = (template: typeof PRESET_TEMPLATES[0]) => {
    const newPreset = convertToOverlayPreset({
      id: nanoid(),
      ...template.preset,
      name: template.preset.name || template.name,
    });
    
    const newPresets = [...presets, newPreset];
    setPresets(newPresets);
    savePresets(newPresets);
  };

  // 프리셋 업데이트
  const updatePreset = (id: string, updates: Partial<OverlayPreset>) => {
    const newPresets = presets.map(p => 
      p.id === id ? { ...p, ...updates } : p
    );
    setPresets(newPresets);
    savePresets(newPresets);
  };

  // 프리셋 삭제
  const deletePreset = (id: string) => {
    const newPresets = presets.filter(p => p.id !== id);
    setPresets(newPresets);
    savePresets(newPresets);
  };

  // URL 복사
  const copyUrl = (url: string, id: string) => {
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  // URL 빌드
  const buildOverlayUrl = (preset: OverlayPreset): string => {
    if (typeof window === "undefined") return "";
    const base = `${window.location.origin}/overlay`;
    const q: Record<string, string> = {
      scale: preset.scale,
      memberSize: String(preset.memberSize),
      totalSize: String(preset.totalSize),
      dense: String(preset.dense),
      anchor: preset.anchor,
      theme: preset.theme,
      showMembers: String(preset.showMembers),
      showTotal: String(preset.showTotal),
      showGoal: String(preset.showGoal),
      showTicker: String(preset.showTicker),
      showTimer: String(preset.showTimer),
      showMission: String(preset.showMission),
      sumFree: String(preset.sumFree),
      hideUi: "1"
    };
    
    if (preset.showGoal) {
      q.goal = String(Math.max(0, parseInt(preset.goal || "0", 10) || 0));
      q.goalLabel = preset.goalLabel;
      q.goalWidth = preset.goalWidth;
      q.goalAnchor = preset.goalAnchor;
    }
    
    if (preset.showTimer && preset.timerStart) {
      q.timerStart = String(preset.timerStart);
      q.timerAnchor = preset.timerAnchor;
    }
    if (preset.showMission) {
      q.missionAnchor = preset.missionAnchor;
    }
    
    // 개별 위치 설정 (URL 파라미터로 변환)
    if (preset.memberPosition?.x && preset.memberPosition?.y) {
      q.memberX = preset.memberPosition.x;
      q.memberY = preset.memberPosition.y;
    }
    if (preset.totalPosition?.x && preset.totalPosition?.y) {
      q.totalX = preset.totalPosition.x;
      q.totalY = preset.totalPosition.y;
    }
    if (preset.goalPosition?.x && preset.goalPosition?.y) {
      q.goalX = preset.goalPosition.x;
      q.goalY = preset.goalPosition.y;
    }
    if (preset.tickerPosition?.x && preset.tickerPosition?.y) {
      q.tickerX = preset.tickerPosition.x;
      q.tickerY = preset.tickerPosition.y;
    }
    if (preset.timerPosition?.x && preset.timerPosition?.y) {
      q.timerX = preset.timerPosition.x;
      q.timerY = preset.timerPosition.y;
    }
    if (preset.missionPosition?.x && preset.missionPosition?.y) {
      q.missionX = preset.missionPosition.x;
      q.missionY = preset.missionPosition.y;
    }
    
    return `${base}?${new URLSearchParams(q).toString()}`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* 헤더 */}
      <div className="bg-black/20 backdrop-blur-sm border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white">🎬 오버레이 스튜디오</h1>
              <p className="text-neutral-300 mt-1">쉽고 빠른 실시간 방송 오버레이 관리</p>
              
              {/* 실시간 성능 상태 */}
              <div className="flex items-center gap-4 mt-2">
                <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs ${
                  connected ? 'bg-green-600/20 text-green-400' : 'bg-red-600/20 text-red-400'
                }`}>
                  <div className={`w-2 h-2 rounded-full ${
                    connected ? 'bg-green-400' : 'bg-red-400'
                  }`} />
                  {connected ? '🟢 실시간 연결' : '🔴 연결 끊김'}
                </div>
                
                <div className="text-xs text-neutral-400">
                  업데이트: <span className="font-mono">{updateCount}</span>
                </div>
                
                {lastUpdateTime && (
                  <div className="text-xs text-neutral-400">
                    마지막: <span className="font-mono">{lastUpdateTime.toLocaleTimeString('ko-KR')}</span>
                    {typeof window !== 'undefined' && (
                      <span> ({Date.now() - lastUpdateTime.getTime()}ms 전)</span>
                    )}
                  </div>
                )}
              </div>
            </div>
            <button
              onClick={() => setShowGuide(true)}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-all"
            >
              📖 사용법
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* 템플릿 선택 */}
        <div className="mb-8">
          <h2 className="text-xl font-semibold text-white mb-4">🎨 템플릿 선택</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {PRESET_TEMPLATES.map((template) => (
              <div
                key={template.name}
                className="bg-white/10 backdrop-blur-sm rounded-xl border border-white/10 p-4 hover:bg-white/15 transition-all cursor-pointer"
                onClick={() => addPreset(template)}
              >
                <div className="text-2xl mb-2">{template.name.split(' ')[0]}</div>
                <div className="text-white font-medium mb-1">{template.name}</div>
                <div className="text-neutral-300 text-sm">{template.description}</div>
                <div className="mt-3 text-emerald-400 text-sm font-medium">클릭하여 추가</div>
              </div>
            ))}
          </div>
        </div>

        {/* 오버레이 관리 */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-white">⚙️ 내 오버레이</h2>
            <div className="text-neutral-300 text-sm">
              총 {presets.length}개의 오버레이
            </div>
          </div>
          
          {presets.length === 0 ? (
            <div className="bg-white/5 backdrop-blur-sm rounded-xl border border-dashed border-white/20 p-12 text-center">
              <div className="text-4xl mb-4">🎬</div>
              <div className="text-white text-lg mb-2">아직 오버레이가 없습니다</div>
              <div className="text-neutral-300 mb-2">위의 템플릿을 선택하여 시작하세요</div>
              <div className="text-neutral-400 text-sm mb-2">각 템플릿은 방송에 맞게 커스터마이징할 수 있습니다</div>
              <div className="text-emerald-400 text-xs">💡 카드를 드래그하여 순서를 변경할 수 있습니다</div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {presets.map((preset, index) => (
                <div
                  key={preset.id}
                  draggable
                  onDragStart={(e) => {
                     e.dataTransfer.setData('text/plain', preset.id);
                     e.dataTransfer.effectAllowed = 'move';
                     setDraggedId(preset.id);
                   }}
                   onDragEnd={() => setDraggedId(null)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const draggedId = e.dataTransfer.getData('text/plain');
                    if (draggedId === preset.id) return;
                    
                    const draggedIndex = presets.findIndex(p => p.id === draggedId);
                    const targetIndex = index;
                    
                    if (draggedIndex === -1) return;
                    
                    const newPresets = [...presets];
                    const [draggedPreset] = newPresets.splice(draggedIndex, 1);
                    newPresets.splice(targetIndex, 0, draggedPreset);
                    
                    setPresets(newPresets);
                    savePresets(newPresets);
                  }}
                  className={`cursor-move hover:opacity-80 transition-all duration-200 ${
                     draggedId === preset.id ? 'opacity-50 scale-95 rotate-2' : ''
                   } ${draggedId && draggedId !== preset.id ? 'opacity-70' : ''}`}
                >
                  <OverlayCard
                    preset={preset}
                    onUpdate={updatePreset}
                    onDelete={deletePreset}
                    onCopyUrl={copyUrl}
                    copiedId={copiedId}
                    url={buildOverlayUrl(preset)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 사용 가이드 */}
        {showGuide && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-slate-800 rounded-xl border border-white/10 p-6 max-w-2xl max-h-[80vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-white">📖 사용법</h2>
                <button
                  onClick={() => setShowGuide(false)}
                  className="text-neutral-400 hover:text-white"
                >
                  ✕
                </button>
              </div>
              
              <div className="space-y-4 text-neutral-300">
                <div>
                  <h3 className="text-emerald-400 font-medium mb-2">1️⃣ 오버레이 만들기</h3>
                  <p>위의 템플릿 중 원하는 것을 클릭하세요. 각 템플릿은 다른 디자인과 기능을 가지고 있습니다.</p>
                </div>
                
                <div>
                  <h3 className="text-emerald-400 font-medium mb-2">2️⃣ 오버레이 설정하기</h3>
                  <p>카드에서 직접 테마, 위치, 표시할 요소들을 조정할 수 있습니다. 실시간으로 프리뷰가 업데이트됩니다.</p>
                </div>
                
                <div>
                  <h3 className="text-emerald-400 font-medium mb-2">3️⃣ 방송에 추가하기</h3>
                  <p>OBS Studio나 Prism Live에서 브라우저 소스를 추가하고, URL 복사 버튼을 눌러서 URL을 붙여넣으세요.</p>
                </div>
                
                <div>
                  <h3 className="text-emerald-400 font-medium mb-2">4️⃣ 실시간 업데이트</h3>
                  <p>설정을 변경하면 방송에서 실시간으로 반영됩니다. 추가적인 설정이 필요 없습니다!</p>
                </div>
              </div>
              
              <div className="mt-6 p-4 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                <h3 className="text-emerald-400 font-medium mb-2">💡 프로 팁</h3>
                <ul className="text-sm space-y-1 text-neutral-300">
                  <li>• 여러 오버레이를 만들어서 상황에 따라 전환할 수 있습니다</li>
                  <li>• 각 오버레이는 독립적인 URL을 가지고 있습니다</li>
                  <li>• 퀵 설정 버튼으로 빠르게 ON/OFF할 수 있습니다</li>
                  <li>• 프리뷰로 실시간으로 어떻게 보일지 확인할 수 있습니다</li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
