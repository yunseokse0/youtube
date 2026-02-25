'use client';

import { useState, useEffect } from 'react';
import { useSSEConnection } from '@/lib/sse-client';

export default function TestRealtime() {
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [position, setPosition] = useState({ x: 50, y: 50 });
  const [updateCount, setUpdateCount] = useState(0);

  const { connected } = useSSEConnection((data) => {
    console.log('📡 SSE 메시지 수신:', data);
    setLastUpdate(new Date());
    setUpdateCount(prev => prev + 1);
    
    if (data.type === 'positionUpdate') {
      setPosition(data.position);
    }
  });

  const testPositionUpdate = async () => {
    const newPos = { 
      x: Math.floor(Math.random() * 100), 
      y: Math.floor(Math.random() * 100) 
    };
    
    console.log('🔄 위치 업데이트 전송:', newPos);
    
    try {
      await fetch('/api/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'positionUpdate',
          position: newPos,
          timestamp: new Date().toISOString()
        }),
      });
      
      // 로컬 상태 즉시 업데이트
      setPosition(newPos);
      setLastUpdate(new Date());
      setUpdateCount(prev => prev + 1);
      
    } catch (error) {
      console.error('❌ 위치 업데이트 실패:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">🚀 실시간 위치 업데이트 테스트</h1>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* 제어 패널 */}
          <div className="bg-gray-800 rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">제어 패널</h2>
            
            <div className="space-y-4">

              
              <div>
                <p className="text-sm text-gray-400 mb-2">업데이트 횟수:</p>
                <div className="text-2xl font-mono">{updateCount}</div>
              </div>
              
              <div>
                <p className="text-sm text-gray-400 mb-2">마지막 업데이트:</p>
                <div className="text-sm font-mono">
                  {lastUpdate ? lastUpdate.toLocaleTimeString('ko-KR') : '없음'}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {lastUpdate && `${Date.now() - lastUpdate.getTime()}ms 전`}
                </div>
              </div>
              
              <button
                onClick={testPositionUpdate}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
              >
                🎲 랜덤 위치 업데이트
              </button>
            </div>
          </div>
          
          {/* 오버레이 미리보기 */}
          <div className="bg-gray-800 rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">오버레이 미리보기</h2>
            
            <div className="relative bg-black rounded-lg" style={{ height: '300px' }}>
              {/* 배경 그리드 */}
              <div className="absolute inset-0 opacity-20">
                {Array.from({ length: 11 }).map((_, i) => (
                  <div key={`v-${i}`} 
                       className="absolute bg-gray-600" 
                       style={{ 
                         left: `${i * 10}%`, 
                         top: 0, 
                         width: '1px', 
                         height: '100%' 
                       }} />
                ))}
                {Array.from({ length: 11 }).map((_, i) => (
                  <div key={`h-${i}`} 
                       className="absolute bg-gray-600" 
                       style={{ 
                         top: `${i * 10}%`, 
                         left: 0, 
                         height: '1px', 
                         width: '100%' 
                       }} />
                ))}
              </div>
              
              {/* 테스트 요소 */}
              <div 
                className="absolute bg-blue-500 text-white px-3 py-2 rounded text-sm font-semibold transform -translate-x-1/2 -translate-y-1/2 transition-all duration-200"
                style={{
                  left: `${position.x}%`,
                  top: `${position.y}%`,
                }}
              >
                📍 테스트 요소
              </div>
              
              {/* 위치 표시 */}
              <div className="absolute bottom-2 left-2 text-xs text-gray-400 bg-black bg-opacity-50 px-2 py-1 rounded">
                X: {position.x}%, Y: {position.y}%
              </div>
            </div>
            
            <div className="mt-4 text-sm text-gray-400">
              💡 위치 변경 시 이 요소가 즉시 이동해야 합니다
            </div>
          </div>
        </div>
        
        {/* 성능 측정 */}
        <div className="mt-8 bg-gray-800 rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">성능 측정</h2>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-mono text-green-400">&lt; 100ms</div>
              <div className="text-sm text-gray-400">목표 응답 시간</div>
            </div>
            <div>
              <div className="text-2xl font-mono text-blue-400">1초</div>
              <div className="text-sm text-gray-400">재연결 시간</div>
            </div>
            <div>
              <div className="text-2xl font-mono text-purple-400">10초</div>
              <div className="text-sm text-gray-400">핑 간격</div>
            </div>
          </div>
        </div>
        
        <div className="mt-8 text-center">
          <a 
            href="/simple-admin" 
            className="inline-block bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
          >
            🎨 간단한 관리자로 이동
          </a>
        </div>
      </div>
    </div>
  );
}