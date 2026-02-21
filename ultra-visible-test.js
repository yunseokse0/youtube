// 매우 높은 가시성 블루 그래프 테스트
const ultraVisibleData = {
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

async function updateUltraVisibleTest() {
  try {
    const response = await fetch('http://localhost:3000/api/state', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(ultraVisibleData)
    });
    
    if (response.ok) {
      console.log('🎯 초고가시성 블루 그래프 적용 완료!');
      console.log('');
      console.log('📊 확인: http://localhost:3000/overlay?theme=excel&showMembers=true&showTotal=true');
      console.log('');
      console.log('🎯 초고가시성 특징:');
      console.log('✅ 불투명도 50-70%로 매우 높음');
      console.log('✅ 진한 블루 컬러로 대비 증가');
      console.log('✅ 행 전체 단일 통합 그래프');
      console.log('✅ 엑셀 테마와 조화로운 색상');
      console.log('');
      console.log('💡 그래프 채움 정도:');
      console.log('1행: 100% (진한 블루)');
      console.log('2행: 약 44% (중간 블루)');
      console.log('3행: 약 10% (연한 블루)');
      console.log('');
      console.log('🔍 확인 포인트:');
      console.log('✅ 그래프가 뚜렷하게 보이는지');
      console.log('✅ 텍스트가 그래프 위에 잘 보이는지');
      console.log('✅ 전체 행이 하나의 그래프로 보이는지');
    }
  } catch (error) {
    console.error('❌ 오류:', error);
  }
}

updateUltraVisibleTest();