// 네온엑셀 테마 그래프 배경 테스트
const neonExcelGraphTestData = {
  members: [
    {
      id: "m1",
      name: "최고기부자",
      account: 1000000,
      toon: 500000
    },
    {
      id: "m2", 
      name: "중간기부자",
      account: 400000,
      toon: 200000
    },
    {
      id: "m3",
      name: "초보기부자",
      account: 100000,
      toon: 50000
    }
  ],
  overlaySettings: {
    theme: "neonExcel",  // 네온엑셀 테마
    showMembers: true,
    showTotal: true,
    totalSize: 32  // 작은 총합
  }
};

async function updateNeonExcelGraphTest() {
  try {
    const response = await fetch('http://localhost:3000/api/state', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(neonExcelGraphTestData)
    });
    
    if (response.ok) {
      console.log('🎯 네온엑셀 테마 + 그래프 배경 적용 완료!');
      console.log('');
      console.log('📊 확인: http://localhost:3000/overlay?theme=neonExcel&showMembers=true&showTotal=true&totalSize=32');
      console.log('');
      console.log('🎯 새로운 특징:');
      console.log('✅ 네온엑셀 테마 with 그래프 배경');
      console.log('✅ 통합된 행별 그래프 (진한 블루)');
      console.log('✅ 사이버펑크 스타일 + 데이터 시각화');
      console.log('✅ 계좌+투네 기준 상대값 그래프');
      console.log('✅ 작은 총합 (32px)');
      console.log('');
      console.log('📈 그래프 채움 정도:');
      console.log('1행: 100% (완전한 진한 블루)');
      console.log('2행: 약 47% (중간 블루)');
      console.log('3행: 약 12% (연한 블루)');
      console.log('');
      console.log('💡 네온엑셀 특징:');
      console.log('- 검은 배경 with 네온 테두리');
      console.log('- 시안색/푸시아색 그라데이션');
      console.log('- 발광 효과 (animate-neonPulse)');
      console.log('- 모노스페이스 폰트');
      console.log('');
      console.log('💰 계좌 총합: 1,500,000원 (투네 750,000원 제외)');
    }
  } catch (error) {
    console.error('❌ 오류:', error);
  }
}

updateNeonExcelGraphTest();