# 프리뷰 미출력 원인 파악 가이드

## 1. 진단 도구 사용법

관리자 페이지 → 오버레이 설정 → 프리셋 펼치기 → **진단** 버튼 클릭

표시되는 정보:
- **URL 길이**: 2000자 초과 시 일부 환경에서 실패 가능
- **상태**: 로딩 중 / 로드 완료 / 에러 메시지
- **새 탭에서 열기**: 프리뷰 URL을 새 탭으로 열어 테스트
- **URL 복사**: URL을 복사해 브라우저 주소창에 직접 입력 테스트

## 2. 가능한 원인별 체크리스트

### A. URL 생성 실패
- **증상**: "프리뷰 URL을 생성할 수 없습니다" 메시지
- **원인**: `window` 미존재(SSR), 또는 빈 URL
- **조치**: 페이지 새로고침, 오버레이 펼친 뒤 다시 시도

### B. URL 길이 초과
- **증상**: 진단에서 URL 길이 1800자 이상
- **원인**: snap(멤버/후원자/미션) 데이터가 커서 base64 인코딩 후 URL이 너무 김
- **조치**: 멤버 수, 후원자 수, 미션 수 줄이기

### C. iframe 로드 실패
- **증상**: "미리보기 네트워크 오류" 또는 "미리보기 로드 실패"
- **원인**: 서버 응답 지연(콜드 스타트), 네트워크 오류, CORS
- **조치**:
  1. "새 탭에서 열기"로 직접 열어보기
  2. 새 탭에서 로드되면 → iframe 제한 가능성 (동일 도메인이면 X-Frame-Options는 SAMEORIGIN으로 허용됨)
  3. 새 탭에서도 실패하면 → 서버/URL 문제

### D. 404
- **증상**: "프리뷰 경로 404"
- **원인**: /overlay 경로 없음, 배포 경로 불일치
- **조치**: next.config.js rewrites, 배포 URL 확인

### E. 콘텐츠는 로드되나 화면에 안 보임
- **증상**: 로딩 완료, 에러 없음, but 빈 화면
- **가능 원인**:
  1. **멤버 없음**: snap에 members가 비어 있으면 기본 멤버로 대체됨. state.members가 비어 있는지 확인
  2. **showMembers=false**: 프리셋에서 멤버 목록이 꺼져 있으면 테이블 미표시
  3. **투명 배경**: 오버레이는 투명 배경. 컨테이너 배경(#0b0b0b)과 대비되어 보여야 함
  4. **viewport/scale**: iframe 크기가 0이거나 매우 작을 수 있음

### F. Render.com 콜드 스타트
- **증상**: 30초~1분 동안 빈 화면 후 로드
- **원인**: 무료 플랜 서버 슬립
- **조치**: "새로고침" 버튼으로 재시도, 또는 유료 플랜 사용

## 3. 데이터 흐름 요약

```
Admin (buildStablePreviewUrl)
  → presetToParams(p) + snap(base64) → URL
  → iframe src=URL

Overlay (iframe 내부)
  → tryDecodeSnapshot(snap) → s (state)
  → ready = !!snap (즉시 true)
  → sp.get() from URL params (presetToParams 값들)
  → members = s.members (snap에서)
  → showMembers && ready → 테이블 렌더
```

## 4. 로컬 디버깅

1. 진단 → URL 복사
2. 브라우저 개발자 도구 → Network 탭
3. iframe의 /overlay 요청 확인: 상태 코드, 응답 시간
4. Console에서 iframe 관련 에러 확인
