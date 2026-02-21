// 테스트용 미션 데이터를 상태 API에 주입하는 스크립트

const testMissions = [
  {
    id: 'mis_1',
    title: '노래 부르기',
    price: '3만',
    isHot: true
  },
  {
    id: 'mis_2', 
    title: '춤 추기',
    price: '2만',
    isHot: false
  },
  {
    id: 'mis_3',
    title: '게임 하기',
    price: '5만',
    isHot: true
  }
];

async function injectTestData() {
  try {
    // 현재 상태 가져오기
    const response = await fetch('http://localhost:3000/api/state');
    const currentState = await response.json();
    
    console.log('현재 상태:', currentState);
    
    // 새로운 상태 생성
    const newState = {
      ...currentState,
      missions: testMissions,
      overlaySettings: {
        ...currentState.overlaySettings,
        showMission: true,
        theme: 'neonExcel'
      }
    };
    
    console.log('새로운 상태:', newState);
    
    // 상태 업데이트
    const updateResponse = await fetch('http://localhost:3000/api/state', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(newState)
    });
    
    if (updateResponse.ok) {
      console.log('✅ 테스트 미션 데이터가 성공적으로 주입되었습니다!');
      console.log('브라우저에서 http://localhost:3000/overlay?theme=neonExcel&showMission=true 로 접속하세요.');
    } else {
      console.error('❌ 상태 업데이트 실패:', updateResponse.status);
      const errorText = await updateResponse.text();
      console.error('에러 내용:', errorText);
    }
    
  } catch (error) {
    console.error('❌ 오류 발생:', error);
    console.log('개발 서버가 실행 중인지 확인하세요: npm run dev');
  }
}

// 실행
injectTestData();