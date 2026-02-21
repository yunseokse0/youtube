// 네온엑셀 테마 + 작은 총합 + 계좌만 합산 테스트
const neonExcelTestData = {
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
    theme: "neonExcel",  // 네온엑셀 테마
    showMembers: true,
    showTotal: true,
    totalSize: 32  // 총합 크기 절반으로 축소 (기본 64에서 32로)
  }
};

async function updateNeonExcelTest() {
  try {
    const response = await fetch('http://localhost:3000/api/state', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(neonExcelTestData)
    });
    
    if (response.ok) {
      console.log('🎯 네온엑셀 테마 + 작은 총합 + 계좌만 합산 적용 완료!');
      console.log('');
      console.log('📊 확인: http://localhost:3000/overlay?theme=neonExcel&showMembers=true&showTotal=true&totalSize=32');
      console.log('');
      console.log('🎯 특징:');
      console.log('✅ 네온엑셀 테마 (cyberpunk 스타일)');
      console.log('✅ 총합 크기 32px (기본 64px의 절반)');
      console.log('✅ 계좌 금액만 총합 계산 (투네 제외)');
      console.log('✅ 진한 블루 그래프 배경');
      console.log('');
      console.log('💡 네온엑셀 테마 특징:');
      console.log('- 검은색 배경 with 사이버펑크 분위기');
      console.log('- 시안색/푸시아색 네온 효과');
      console.log('- 모노스페이스 폰트');
      console.log('- 발광하는 테두리 효과');
      console.log('');
      console.log('📊 그래프 채움 정도:');
      console.log('1행: 100% (완전한 진한 블루)');
      console.log('2행: 약 44% (중간만 블루)');
      console.log('3행: 약 10% (조금만 블루)');
      console.log('');
      console.log('💰 계좌 총합: 750,000원 (투네 480,000원 제외)');
    }
  } catch (error) {
    console.error('❌ 오류:', error);
  }
}

updateNeonExcelTest();