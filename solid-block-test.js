// 매우 뚜렷한 고체 색상 블록 그래프 테스트
const solidBlockData = {
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

async function updateSolidBlockTest() {
  try {
    const response = await fetch('http://localhost:3000/api/state', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(solidBlockData)
    });
    
    if (response.ok) {
      console.log('🎯 뚜렷한 고체 색상 블록 그래프 적용 완료!');
      console.log('');
      console.log('📊 확인: http://localhost:3000/overlay?theme=excel&showMembers=true&showTotal=true');
      console.log('');
      console.log('🎯 뚜렷한 특징:');
      console.log('✅ 진한 블루 고체 색상 (#3b82f6)');
      console.log('✅ 100% 불투명도로 매우 뚜렷함');
      console.log('✅ 행 전체 단일 통합 그래프');
      console.log('✅ 엑셀 테마와 대조적임');
      console.log('');
      console.log('💡 그래프 채움 정도:');
      console.log('1행: 100% (완전한 진한 블루)');
      console.log('2행: 약 44% (중간만 블루)');
      console.log('3행: 약 10% (조금만 블루)');
      console.log('');
      console.log('🔍 확인 포인트:');
      console.log('✅ 그래프가 매우 뚜렷하게 보이는지');
      console.log('✅ 텍스트가 흰색 배경 위에 잘 보이는지');
      console.log('✅ 전체 행이 하나의 단색 블록으로 보이는지');
    }
  } catch (error) {
    console.error('❌ 오류:', error);
  }
}

updateSolidBlockTest();