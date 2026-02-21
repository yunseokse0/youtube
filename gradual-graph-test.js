// 서서히 올라가는 그래프 테스트
const gradualData = {
  members: [
    {
      id: "m1",
      name: "최고기부자",
      account: 500000,
      toon: 300000
    },
    {
      id: "m2", 
      name: "중상위기부자",
      account: 300000,
      toon: 200000
    },
    {
      id: "m3",
      name: "중간기부자",
      account: 150000,
      toon: 100000
    },
    {
      id: "m4",
      name: "초보기부자",
      account: 50000,
      toon: 30000
    },
    {
      id: "m5",
      name: "시작기부자",
      account: 10000,
      toon: 5000
    }
  ],
  overlaySettings: {
    theme: "excel",
    showMembers: true,
    showTotal: false
  }
};

async function updateGradualTest() {
  try {
    const response = await fetch('http://localhost:3000/api/state', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(gradualData)
    });
    
    if (response.ok) {
      console.log('🌊 서서히 올라가는 그래프 적용 완료!');
      console.log('');
      console.log('📊 확인: http://localhost:3000/overlay?theme=excel&showMembers=true&showTotal=false');
      console.log('');
      console.log('🎯 그래프 특징:');
      console.log('✅ 전체 행이 하나의 통합된 그래프 배경');
      console.log('✅ 서서히 올라가는 녹색 그라데이션');
      console.log('✅ 총 기부금 기준 상대값 (계좌+투네)');
      console.log('✅ 높을수록 더 많이 채워짐');
      console.log('');
      console.log('📈 예상 그래프 채움 정도:');
      console.log('1행: 100% (완전 채움)');
      console.log('2행: 약 62%');
      console.log('3행: 약 31%');
      console.log('4행: 약 10%');
      console.log('5행: 약 2%');
    }
  } catch (error) {
    console.error('❌ 오류:', error);
  }
}

updateGradualTest();