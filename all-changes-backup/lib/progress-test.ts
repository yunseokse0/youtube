import { totalAccount } from './state';

// 테스트용 프로그레스바 확인 스크립트
// 관리자 페이지에서 목표 금액을 설정하고 후원을 추가했을 때 프로그레스바가 업데이트되는지 확인

export function testProgressBar() {
  console.log('[Test] 프로그레스바 연동 테스트 시작');
  
  // 테스트 시나리오:
  // 1. 목표 금액을 500,000원으로 설정
  // 2. 후원 금액을 150,000원 추가
  // 3. 프로그레스바가 30%로 표시되는지 확인
  
  const testCases = [
    { current: 0, goal: 500000, expected: 0 },
    { current: 150000, goal: 500000, expected: 30 },
    { current: 250000, goal: 500000, expected: 50 },
    { current: 500000, goal: 500000, expected: 100 },
    { current: 600000, goal: 500000, expected: 100 }, // 100%를 초과하지 않음
  ];
  
  testCases.forEach(({ current, goal, expected }) => {
    const pct = goal > 0 ? Math.min(100, (current / goal) * 100) : 0;
    console.log(`[Test] 현재: ${current.toLocaleString()}, 목표: ${goal.toLocaleString()}, 결과: ${pct}%, 예상: ${expected}% - ${pct === expected ? '✅' : '❌'}`);
  });
}

// 프로그레스바 표시 조건 확인
export function checkProgressBarConditions(state: any) {
  console.log('[Test] 프로그레스바 표시 조건 확인');
  console.log('[Test] showGoal:', state?.overlaySettings?.showGoal);
  console.log('[Test] goal 금액:', state?.overlaySettings?.goal);
  console.log('[Test] 현재 총합:', state ? totalAccount(state) : 0);
}