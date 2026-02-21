// 시각적 테스트를 위한 업데이트 스크립트
const testScenarios = [
  {
    name: "대조적인 금액 차이",
    members: [
      { id: "m1", name: "최고기부자", account: 500000, toon: 200000 },
      { id: "m2", name: "중간기부자", account: 150000, toon: 80000 },
      { id: "m3", name: "소액기부자", account: 30000, toon: 10000 }
    ]
  }
];

async function updateVisualTest() {
  const testData = {
    members: testScenarios[0].members,
    overlaySettings: {
      theme: "excel",
      showMembers: true,
      showTotal: false
    }
  };

  try {
    const response = await fetch('http://localhost:3000/api/state', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testData)
    });
    
    if (response.ok) {
      console.log('🎨 시각적 테스트 데이터 적용 완료!');
      console.log('📊 그래프 확인: http://localhost:3000/overlay?theme=excel&showMembers=true&showTotal=false');
      console.log('');
      console.log('✨ 확인사항:');
      console.log('- 각 행 뒤에 배경으로 그래프가 표시되는지');
      console.log('- 금액이 높을수록 그래프 바가 더 길게 표시되는지');
      console.log('- 계좌는 왼쪽에서, 투네는 오른쪽에서 채워지는지');
      console.log('- 텍스트가 그래프 위에 잘 보이는지');
    }
  } catch (error) {
    console.error('❌ 오류:', error);
  }
}

updateVisualTest();