import React from 'react';

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
};

interface OverlayCardProps {
  preset: OverlayPreset;
  onUpdate: (id: string, updates: Partial<OverlayPreset>) => void;
  onDelete: (id: string) => void;
  onCopyUrl: (url: string, id: string) => void;
  copiedId: string | null;
  url: string;
}

export function OverlayCard({ preset, onUpdate, onDelete, onCopyUrl, copiedId, url }: OverlayCardProps) {
  const quickSettings = [
    { key: 'showMembers', label: '멤버', icon: '👥' },
    { key: 'showTotal', label: '총합', icon: '💰' },
    { key: 'showGoal', label: '목표', icon: '🎯' },
    { key: 'showTicker', label: '티커', icon: '📜' },
    { key: 'showTimer', label: '타이머', icon: '⏰' },
    { key: 'showMission', label: '미션', icon: '🎮' },
  ];

  const themes = [
    { value: 'default', label: '기본' },
    { value: 'excel', label: '엑셀' },
    { value: 'neon', label: '네온' },
    { value: 'neonExcel', label: '네온 엑셀' },
    { value: 'retro', label: '레트로' },
    { value: 'minimal', label: '미니멀' },
    { value: 'rpg', label: 'RPG' },
    { value: 'pastel', label: '파스텔' },
  ];

  const positions = [
    { value: 'tl', label: '좌상단' },
    { value: 'tr', label: '우상단' },
    { value: 'bl', label: '좌하단' },
    { value: 'br', label: '우하단' },
    { value: 'bc', label: '하단중앙' },
    { value: 'tc', label: '상단중앙' },
  ];

  return (
    <div className="bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 p-4 hover:bg-white/10 transition-all duration-200">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <input
            className="bg-transparent border-b border-white/20 px-2 py-1 text-lg font-semibold focus:border-emerald-500 focus:outline-none"
            value={preset.name}
            onChange={(e) => onUpdate(preset.id, { name: e.target.value })}
            placeholder="오버레이 이름"
          />
          <span className={`px-2 py-1 rounded-full text-xs ${preset.showGoal ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-neutral-400'}`}>
            {quickSettings.filter(s => preset[s.key as keyof OverlayPreset]).length} 활성
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => onCopyUrl(url, preset.id)}
            className={`px-3 py-1 rounded-lg text-sm transition-all ${
              copiedId === preset.id 
                ? 'bg-emerald-600 text-white' 
                : 'bg-white/10 hover:bg-white/20 text-white'
            }`}
          >
            {copiedId === preset.id ? '✅ 복사됨!' : '📋 URL 복사'}
          </button>
          <button
            onClick={() => {
              if (confirm('정말 이 오버레이를 삭제하시겠습니까?')) {
                onDelete(preset.id);
              }
            }}
            className="px-3 py-1 rounded-lg text-sm bg-red-600/20 hover:bg-red-600/40 text-red-300 transition-all"
          >
            🗑️ 삭제
          </button>
        </div>
      </div>

      {/* 퀵 설정 */}
      <div className="mb-4">
        <h3 className="text-sm font-medium text-neutral-300 mb-2">퀵 설정</h3>
        <div className="grid grid-cols-3 gap-2">
          {quickSettings.map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => onUpdate(preset.id, { [key]: !preset[key as keyof OverlayPreset] })}
              className={`p-3 rounded-lg border transition-all ${
                preset[key as keyof OverlayPreset]
                  ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300'
                  : 'border-white/10 bg-white/5 text-neutral-400 hover:bg-white/10'
              }`}
            >
              <div className="text-lg mb-1">{icon}</div>
              <div className="text-xs">{label}</div>
              <div className="text-xs opacity-75">{preset[key as keyof OverlayPreset] ? 'ON' : 'OFF'}</div>
            </button>
          ))}
        </div>
      </div>

      {/* 고급 설정 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-sm font-medium text-neutral-300 mb-2">테마</label>
          <select
            value={preset.theme}
            onChange={(e) => onUpdate(preset.id, { theme: e.target.value })}
            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-emerald-500 focus:outline-none"
          >
            {themes.map(theme => (
              <option key={theme.value} value={theme.value}>{theme.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-300 mb-2">배율</label>
          <input
            type="number"
            value={preset.scale}
            onChange={(e) => onUpdate(preset.id, { scale: e.target.value })}
            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-emerald-500 focus:outline-none"
            min="0.5"
            max="3"
            step="0.1"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-300 mb-2">위치</label>
          <select
            value={preset.anchor}
            onChange={(e) => onUpdate(preset.id, { anchor: e.target.value })}
            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-emerald-500 focus:outline-none"
          >
            {positions.map(pos => (
              <option key={pos.value} value={pos.value}>{pos.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-300 mb-2">글자 크기</label>
          <input
            type="range"
            min="10"
            max="40"
            value={preset.memberSize}
            onChange={(e) => onUpdate(preset.id, { memberSize: e.target.value })}
            className="w-full accent-emerald-500"
          />
          <div className="text-xs text-neutral-400 text-center">{preset.memberSize}px</div>
        </div>
      </div>

      {/* 목표 금액 설정 */}
      {preset.showGoal && (
        <div className="bg-white/5 rounded-lg p-3 mb-4">
          <h3 className="text-sm font-medium text-neutral-300 mb-2">🎯 목표 금액 설정</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-neutral-400 mb-1">목표 금액 (원)</label>
              <input
                type="number"
                value={preset.goal}
                onChange={(e) => onUpdate(preset.id, { goal: e.target.value })}
                className="w-full px-3 py-2 rounded bg-white/5 border border-white/10 focus:border-emerald-500 focus:outline-none"
                placeholder="예: 500000"
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-400 mb-1">라벨</label>
              <input
                type="text"
                value={preset.goalLabel}
                onChange={(e) => onUpdate(preset.id, { goalLabel: e.target.value })}
                className="w-full px-3 py-2 rounded bg-white/5 border border-white/10 focus:border-emerald-500 focus:outline-none"
                placeholder="예: 후원 목표"
              />
            </div>
          </div>
        </div>
      )}

      {/* 프리뷰 */}
      <div className="bg-white/5 rounded-lg p-3">
        <h3 className="text-sm font-medium text-neutral-300 mb-2">👁️ 프리뷰</h3>
        <div className="bg-black rounded-lg overflow-hidden" style={{ height: '200px' }}>
          <iframe
            src={url}
            title={`preview-${preset.id}`}
            className="w-full h-full"
            style={{ background: 'transparent' }}
            scrolling="no"
          />
        </div>
        <div className="text-xs text-neutral-400 mt-2">
          💡 이 오버레이를 OBS/Prism Live에 추가하려면 URL을 복사해서 브라우저 소스로 추가하세요.
        </div>
      </div>
    </div>
  );
}