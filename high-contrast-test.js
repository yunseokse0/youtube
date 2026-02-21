// 더 뚜렷한 그래프를 위한 테스트 데이터
const highContrastData = {
  members: [
    {
      id: "m1",
      name: "최대기부자",
      account: 1000000,  // 100% 기준
      toon: 800000
    },
    {
      id: "m2", 
      name: "중간기부자", 
      account: 500000,   // 50%
      toon: 300000
    },
    {
      id: "m3",
      name: "소액기부자",
      account: 100000,  // 10%
      toon: 50000
    },
    {
      id: "m4",
      name: "시작기부자", 
      account: 10000,   // 1%
      toon: 5000
    }
  ],
  overlaySettings: {
    theme: "excel",
    showMembers: true,
    showTotal: false
  }
};

async function updateHighContrastTest() {
  try {
    const response = await fetch('http://localhost:3000/api/state', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(highContrastData)
    });
    
    if (response.ok) {
      console.log('🎯 높은 대비 그래프 데이터 적용 완료!');
      console.log('');
      console.log('📈 그래프 확인: http://localhost:3000/overlay?theme=excel&showMembers=true&showTotal=false');
      console.log('');
      console.log('🔍 확인사항:');
      console.log('✅ 1행 (최대기부자): 계좌/투네 모두 100% 채움');
      console.log('✅ 2행 (중간기부자): 약 50% 정도 채움'); 
      console.log('✅ 3행 (소액기부자): 약 10% 정도 채움');
      console.log('✅ 4행 (시작기부자): 약 1% 정도 채움');
      console.log('');
      console.log('💡 파란색 = 계좌 (왼쪽→오른쪽)');
      console.log('💡 보라색 = 투네 (오른쪽→왼쪽)');
    }
  } catch (error) {
    console.error('❌ 오류:', error);
  }
}

updateHighContrastTest();