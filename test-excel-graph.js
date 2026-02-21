// 테스트 데이터를 위한 간단한 스크립트
const testData = {
  members: [
    {
      id: "m1",
      name: "김철수",
      account: 150000,
      toon: 50000
    },
    {
      id: "m2", 
      name: "이영희",
      account: 230000,
      toon: 30000
    },
    {
      id: "m3",
      name: "박지민", 
      account: 80000,
      toon: 120000
    },
    {
      id: "m4",
      name: "최민수",
      account: 300000,
      toon: 80000
    }
  ],
  overlaySettings: {
    theme: "excel",
    showMembers: true,
    showTotal: false
  }
};

// API 호출 함수
async function updateTestData() {
  try {
    const response = await fetch('http://localhost:3000/api/state', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testData)
    });
    
    if (response.ok) {
      console.log('✅ 테스트 데이터 적용 완료!');
      console.log('🌐 브라우저에서 확인: http://localhost:3000/overlay?theme=excel&showMembers=true&showTotal=false');
    } else {
      console.error('❌ 데이터 적용 실패:', response.status);
    }
  } catch (error) {
    console.error('❌ 연결 오류:', error);
  }
}

updateTestData();