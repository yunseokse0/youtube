#!/usr/bin/env node
/** 로컬 UI 반영 확인 페이지 URL 출력 */
const url = "http://localhost:3000/overlay/battle-effects-demo/verify";
console.log(`
대전 연출 UI 반영 확인
======================
1) npm run dev
2) 브라우저에서 열기:

   ${url}

통합 허브: http://localhost:3000/overlay/battle-effects-demo
(시그 v16 · VS 게이지 / 식사 v8 · 구 UI면 npm run dev:clean)
`);
