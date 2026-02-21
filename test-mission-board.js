// 테스트 스크립트: 전광판 미션 메뉴판 확인
fetch('http://localhost:3000/api/state')
  .then(r => r.json())
  .then(s => {
    const next = { ...s };
    next.missions = [
      { id: 'mis_1', title: '노래 부르기', price: '3만', isHot: true },
      { id: 'mis_2', title: '댄스 챌린지', price: '5만' },
      { id: 'mis_3', title: '벌칙 수행', price: '1만' }
    ];
    next.overlaySettings = {
      ...(next.overlaySettings || {}),
      showMission: true,
      theme: 'neonExcel'
    };
    return fetch('http://localhost:3000/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next)
    });
  })
  .then(r => {
    if (r.ok) {
      console.log('✅ 전광판 미션 데이터 적용 완료');
      console.log('🌐 확인 URL: http://localhost:3000/overlay?theme=neonExcel&showMission=true');
    } else {
      console.error('❌ 미션 데이터 적용 실패');
    }
  })
  .catch(e => console.error('❌ 오류:', e));