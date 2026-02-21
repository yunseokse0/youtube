// 원본 네온엑셀 테마 (그래프 없이)
const originalNeonExcelTestData = {
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
    theme: "neonExcel",  // 원본 네온엑셀 테마
    showMembers: true,
    showTotal: true,
    totalSize: 32  // 작은 총합
  }
};

async function updateOriginalNeonExcelTest() {
  try {
    const response = await fetch('http://localhost:3000/api/state', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(originalNeonExcelTestData)
    });
    
    if (response.ok) {
      console.log('🎯 원본 네온엑셀 테마 복원 완료!');
      console.log('');
      console.log('📊 확인: http://localhost:3000/overlay?theme=neonExcel&showMembers=true&showTotal=true&totalSize=32');
      console.log('');
      console.log('✅ 원본 특징 유지:');
      console.log('- 검은 배경 with 네온 테두리');
      console.log('- 시안색/푸시아색 그라데이션');
      console.log('- 발광 효과 (animate-neonPulse)');
      console.log('- 모노스페이스 폰트');
      console.log('- ❌ 그래프 배경 제거 (원본 디자인)');
      console.log('');
      console.log('🎯 변경사항:');
      console.log('- 그래프 배경 기능은 엑셀 테마에만 적용');
      console.log('- 네온엑셀 테마는 원본 디자인 유지');
      console.log('- 총합 크기만 32px로 축소됨');
      console.log('');
      console.log('💡 원본 네온엑셀 특징:');
      console.log('- 사이버펑크 분위기의 깔끔한 테이블');
      console.log('- 네온 발광 테두리 효과');
      console.log('- 시원한 시안색/블루 톤');
      console.log('- 기술적이고 미래적인 느낌');
    }
  } catch (error) {
    console.error('❌ 오류:', error);
  }
}

updateOriginalNeonExcelTest();