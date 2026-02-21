// 통합 그래프 + 총합 표시 테스트
const unifiedGraphData = {
  members: [
    {
      id: "m1",
      name: "최고기부자",
      account: 500000,
      toon: 300000
    },
    {
      id: "m2", 
      name: "중간기부자",
      account: 200000,
      toon: 150000
    },
    {
      id: "m3",
      name: "초보기부자",
      account: 50000,
      toon: 30000
    }
  ],
  overlaySettings: {
    theme: "excel",
    showMembers: true,
    showTotal: true  // 총합 표시 활성화
  }
};

async function updateUnifiedGraphTest() {
  try {
    const response = await fetch('http://localhost:3000/api/state', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(unifiedGraphData)
    });
    
    if (response.ok) {
      console.log('🎯 통합 그래프 + 총합 표시 적용 완료!');
      console.log('');
      console.log('📊 확인: http://localhost:3000/overlay?theme=excel&showMembers=true&showTotal=true');
      console.log('');
      console.log('🎯 확인사항:');
      console.log('✅ 각 행 전체가 하나의 통합된 그래프 배경');
      console.log('✅ 서서히 올라가는 녹색 그라데이션');
      console.log('✅ 총 기부금 (계좌+투네) 기준 상대값');
      console.log('✅ 총합 금액 표시됨');
      console.log('');
      console.log('💡 그래프 채움 정도:');
      console.log('1행: 100% (완전 채움)');
      console.log('2행: 약 44% 채움');
      console.log('3행: 약 10% 채움');
    }
  } catch (error) {
    console.error('❌ 오류:', error);
  }
}

updateUnifiedGraphTest();