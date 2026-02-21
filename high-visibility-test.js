// 높은 가시성 그래프 테스트
const highVisibilityData = {
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
    showTotal: true
  }
};

async function updateHighVisibilityTest() {
  try {
    const response = await fetch('http://localhost:3000/api/state', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(highVisibilityData)
    });
    
    if (response.ok) {
      console.log('🎯 높은 가시성 그래프 적용 완료!');
      console.log('');
      console.log('📊 확인: http://localhost:3000/overlay?theme=excel&showMembers=true&showTotal=true');
      console.log('');
      console.log('🎯 개선사항:');
      console.log('✅ 불투명도 40-60%로 대폭 증가');
      console.log('✅ 더 진한 녹색 그라데이션');
      console.log('✅ 행 전체 단일 통합 그래프');
      console.log('');
      console.log('💡 그래프 채움 정도:');
      console.log('1행: 100% (진한 녹색)');
      console.log('2행: 약 44% (중간 녹색)');
      console.log('3행: 약 10% (연한 녹색)');
    }
  } catch (error) {
    console.error('❌ 오류:', error);
  }
}

updateHighVisibilityTest();