export type Member = {
  /** 멤버 고유 식별자 */
  id: string;
  /** 방송 표시용 닉네임 */
  name: string;
  /** 정산 문서 표기용 실명 */
  realName?: string;
  /** 계좌 후원 누적 금액 */
  account: number;
  /** 투네(플랫폼) 후원 누적 금액 */
  toon: number;
  /** 수동 관리 기여도 금액(계좌/투네와 별도 집계) */
  contribution?: number;
  /** 화장실 횟수(수동 기록·차감만, 후원 자동 반영 없음). -1 = 무제한(∞) */
  restroom?: number;
  /** 개인 목표 금액 */
  goal?: number;
  /** 운영비 멤버 여부(세금/비율 예외 처리) */
  operating?: boolean;
};

export type DonorTarget = "account" | "toon";

export type Donor = {
  /** 후원 건 식별자 */
  id: string;
  /** 후원자 표시명 */
  name: string;
  /** 후원 금액 */
  amount: number;
  /** 연결된 멤버 ID */
  memberId: string;
  /** 후원 시각(epoch ms), 멀티탭 병합 기준값 */
  at: number;
  /** 후원 채널(계좌/투네) */
  target?: DonorTarget;
  /** 투네·계좌 후원 메시지(투네이션 comment 등) */
  message?: string;
  /** 투네 자동 배치 멤버 — 관리자 수동 재지정 대상 */
  memberAutoAssigned?: boolean;
  /** 단체짠 분배로 생성된 멤버별 행 */
  groupSplit?: boolean;
  /** 단체짠 나누기 원본 행 — 리스트 유지·합산 제외·삭제 불가 */
  groupSplitSource?: boolean;
  /** 단체짠 원본 등 — 리스트에는 표시하되 멤버·순위 합산에서 제외 */
  donationExcluded?: boolean;
  /**
   * 상류사회 영토 확장 방향 (B·C 좌석용).
   * left=왼쪽만 / right=오른쪽만 / split=양분. A·D는 무시(고정 방향).
   */
  hsPushDir?: "left" | "right" | "split";
};

export type ContributionLog = {
  id: string;
  memberId: string;
  amount: number;
  /** 1=추가, -1=차감 */
  delta: 1 | -1;
  note?: string;
  at: number;
};

/** 화장실 수동 기록(구조는 기여도와 동일, amount=횟수) */
export type RestroomLog = ContributionLog;

export type MissionItem = {
  id: string;
  title: string;
  price: string;
  isHot?: boolean;
};

export type SigItem = {
  id: string;
  name: string;
  price: number;
  imageUrl: string;
  memberId?: string;
  maxCount: number;
  soldCount: number;
  /** 시그 보드(롤링) 노출 */
  isRolling: boolean;
  /** 시그 판매/회전판 오버레이 등 활성 판매 대상 */
  isActive: boolean;
};

/** 서버가 저장하는 회전판 상태(당첨은 서버에서만 결정) */
export type RouletteState = {
  phase?: "IDLE" | "SPINNING" | "LANDED" | "CONFIRM_PENDING" | "CONFIRMED" | "CANCELLED";
  isRolling: boolean;
  /** 마지막(또는 단일) 스핀 당첨 — 오버레이 릴 정렬용 */
  result: SigItem | null;
  spinCount: number;
  /** 스핀 시작 시각(ms) — 오버레이 애니메이션 동기화 */
  startedAt: number;
  /** 회수>1일 때 회차별 당첨 목록(있으면 result는 보통 마지막 항목과 동일) */
  results?: SigItem[];
  /** 회차별 적용 금액대(null = 전체 풀) */
  spinPriceFilters?: (number | null)[];
  /** 회차별 적용 최소/최대 금액 범위(null = 전체 범위) */
  spinPriceRanges?: ({ min: number | null; max: number | null } | null)[];
  /** 시네마틱 플로우용 최종 선정 5개 */
  selectedSigs?: SigItem[];
  /** 시네마틱 플로우용 원샷 카드 정보 */
  oneShotResult?: {
    id: string;
    name: string;
    price: number;
  } | null;
  /** 배경 투명도(0.4~1.0) */
  overlayOpacity?: number;
  /** 회전판에 노출할 메뉴 수(5~20) */
  menuCount?: number;
  /** 확정 시그 카드 줄만 zoom 축소 비율(%). 관리자 슬라이더·저장. URL 미지정 시 사용 */
  sigResultScalePct?: number;
  /** 메뉴가 부족할 때 전체 활성 시그에서 자동 보충 */
  menuFillFromAllActive?: boolean;
  /** 관리자 옵션: 값을 올리면 시그 오버레이가 즉시 강제 새로고침됨(OBS 캐시 우회) */
  overlayReloadNonce?: number;
  /** 최근 세션 식별자 */
  sessionId?: string;
  /** 착지·확정된 시그 id — 다음 회전 추첨 후보에서 제외(회전판 초기화 시 유지, 수동 초기화 시만 비움) */
  sessionExcludedSigIds?: string[];
  /** 최근 확정 로그 */
  lastFinishedAt?: number;
  /** 최근 이력 스냅샷(최대 50) */
  historyLogs?: Array<{
    id: string;
    sessionId: string;
    phase: "LANDED" | "CONFIRMED" | "CANCELLED";
    selectedSigs: SigItem[];
    selectedSigIds: string[];
    oneShotPrice: number;
    totalPrice: number;
    timestamp: number;
    adminId?: string;
    reason?: string;
  }>;
};

export type LegacyOverlaySettings = {
  presets?: unknown[];
  [key: string]: unknown;
};

export type SigMatchState = Record<string, number>;
export type MealMatchState = Record<string, number>;
export type MealBattleParticipant = {
  memberId: string;
  name: string;
  score: number;
  /** 이 참가자 개인 목표(팀 게이지 비율·개인 채움 합산에 사용) */
  goal: number;
  color: string;
  /** true면 관리자 후원 입력 시 식대전 점수에 반영. 멤버 계좌/투네·엑셀 집계는 항상 반영. */
  donationLinkActive: boolean;
  /** 후원 연동 ON을 누른 시각(epoch ms). 이 시각 이후 후원부터 식대전 점수에 반영. */
  donationLinkStartedAt?: number;
};

/** 식사 대전 게이지 오버레이 연출 on/off */
export type MealGaugeEffects = {
  /** 90% 채움·타이머 임박 시 펄스·글로우·줄무늬 */
  critical: boolean;
  /** 점수 증가 시 +N 플로팅 */
  floatingScore: boolean;
  /** 1등 멤버(팀) 이름 옆 왕관 */
  rankUp: boolean;
  /** 타이머 10초/5초 긴장 연출 */
  timerTension: boolean;
  /** 점수 변동 시 막대 스프링·맥동·채움 끝 하이라이트 */
  gaugeMotion: boolean;
};

export type MealBattleState = {
  participants: MealBattleParticipant[];
  /** 참가 체크 전에도 멤버별 게이지 색 지정(참가 시 participant.color로 사용) */
  memberGaugeColors: Record<string, string>;
  /** 상단 큰 제목 */
  overlayTitle: string;
  /** 보라 말풍선(미션/서브 문구) */
  currentMission: string;
  /** 오버레이 우상단 규칙 박스(비우면 숨김). 말풍선과 별도 */
  overlayRulesText?: string;
  /** 규칙 박스 본문 글자 크기(px). 기본 16 */
  overlayRulesFontSize?: number;
  /** 하단 후원 표 열·총합 표시 옵션 */
  donationTableOptions?: DonationTableColumnsOptions;
  /** 신규 참가 시 기본 개인 목표·구버전 단일 목표 호환 */
  totalGoal: number;
  timerTheme: "default" | "neon" | "minimal" | "danger";
  timerSize: number;
  /** 말풍선 배경/글자 */
  missionBubbleBg: string;
  missionBubbleTextColor: string;
  /** 게이지 트랙(빈 영역) 배경·테두리 */
  gaugeTrackBg: string;
  gaugeTrackBorderColor: string;
  /** 식사 매치「개인」모드에서 목표 대비 채워지는 막대 색 */
  gaugeFillColor: string;
  /** 점수 숫자 색 */
  scoreTextColor: string;
  /** 이름 태그 */
  nameTagBg: string;
  nameTagTextColor: string;
  /** 메인 패널(게이지 영역) 외곽 테두리 표시 */
  showPanelBorder: boolean;
  /** 외곽 테두리 색(활성 시) */
  panelBorderColor: string;
  /** 게이지 트랙(빈 트랙) 외곽선 표시 */
  showGaugeTrackBorder: boolean;
  /** 팀대전: 막대를 팀 A/B 합산으로 표시(팀에 배정된 참가자만 합산). 식사 매치「팀」모드에서는 2분할 막대, 「개인」모드에서는 채움 막대 안을 팀 비율로 색 분할 */
  teamBattleEnabled: boolean;
  /** true(기본: 팀대전 ON): 후원 금액을 원 단위 그대로 점수에 반영. false: 만 원 단위 환산 */
  scoreUsesRawDonationAmount?: boolean;
  teamAName: string;
  teamBName: string;
  /** 팀 목표(0이면 참가자 개인 목표 합 자동 사용) */
  teamAGoal: number;
  /** 팀 목표(0이면 참가자 개인 목표 합 자동 사용) */
  teamBGoal: number;
  teamAMemberIds: string[];
  teamBMemberIds: string[];
  teamAColor: string;
  teamBColor: string;
  /** 게이지 애니메이션 연출 (미설정 시 전부 켜짐) */
  gaugeEffects?: MealGaugeEffects;
};

export type TimerState = {
  remainingTime: number;
  isActive: boolean;
  lastUpdated: number;
};

export type TimerDisplayStyle = {
  showHours: boolean;
  /** 타이머 글꼴 id (`src/lib/timer-font-style.ts`) — 기본 mono */
  fontFamily: string;
  fontColor: string;
  bgColor: string;
  borderColor: string;
  outlineColor: string;
  outlineWidth: number;
  bgOpacity: number;
  /** 타이머 표시 크기(%) */
  scalePercent: number;
};

/** 일반 타이머 오버레이 사용 여부 */
export type MatchTimerEnabled = {
  /** 방송용 자유 타이머(매치와 무관) */
  general: boolean;
};

/** 시그 n:n 규칙: 같은 풀에 속한 멤버는 시그 1건을 풀 인원 수로 나눠 동일 반영. 풀에 없는 멤버는 1:1(후원 건의 memberId만). */
export type SigMatchPool = {
  id: string;
  memberIds: string[];
};

export type DonationTableColumnsOptions = {
  /** 후원합계 열 표시 */
  showCombinedColumn?: boolean;
  /** 기여도 열 표시 */
  showContributionColumn?: boolean;
  /** 화장실 열 표시 */
  showRestroomColumn?: boolean;
  /** 하단 총합 행 표시 */
  showTableSumRow?: boolean;
  /** 총합 행 기여도 칸 표시(기여도 열 ON일 때) */
  showContributionSum?: boolean;
};

export type SigMatchSettings = {
  /** 시그 대전 활성화 여부 */
  isActive: boolean;
  /** 목표 점수(선택 UI/오버레이 표시용) */
  targetCount: number;
  /** 대전 제목 */
  title: string;
  /** 후원 메모/이름에 포함되면 시그로 인정할 키워드 */
  keyword: string;
  /** 시그니처 금액 목록 */
  signatureAmounts: number[];
  /** 점수 집계 방식 */
  scoringMode: "count" | "amount";
  /**
   * 금액 모드·벌칙대전: true(기본)면 멤버 후원 전부 집계.
   * false면 시그 키워드/시그니처 금액 후원만 집계.
   */
  countAllDonations?: boolean;
  /** count 모드에서 포인트→정산 환산 단가 */
  incentivePerPoint: number;
  /** 멤버별 추가·차감 버튼 단위(건수/금액). 미설정 시 집계 방식 기본값 */
  manualAddStep?: number;
  manualDeductStep?: number;
  /**
   * n:n 풀 목록(멤버 1명 이상). 비어 있으면 후원은 멤버별 1:1 집계.
   * 한 멤버는 한 풀에만 속할 수 있음(먼저 정의된 풀 우선).
   * 풀 2개 → 오버레이 좌·우(1:2·2:1 등), 풀 3개 → 삼자(1:1:1) 표시에 사용.
   */
  sigMatchPools: SigMatchPool[];
  /**
   * 랭킹·오버레이에 표시·집계할 멤버 id 목록.
   * 비어 있으면 전원. 하나 이상이면 해당 멤버만 대전에 포함(나머지는 목록에서 제외).
   */
  participantMemberIds: string[];
  /**
   * 멤버별 후원 연동(엑셀 배정과 동일 donors 소스).
   * - 항목 없음: 하위호환으로 연동 ON·전체 기간 집계
   * - active=false: 해당 멤버 후원은 시그 점수에 미반영(엑셀/멤버 금액은 유지)
   * - active=true + startedAt: 그 시각 이후 후원만 집계
   */
  donationLinks?: Record<string, { active: boolean; startedAt?: number }>;
  /** 시그 대전 오버레이 카운트다운 총 시간(초). 0이면 타이머 숨김 */
  overlayTimerDurationSec?: number;
  /** 시그 대전 오버레이 타이머 종료 시각(epoch ms). null/0이면 정지 */
  overlayTimerEndAt?: number | null;
  /** 오버레이 우상단 규칙 박스 문구(비우면 숨김) */
  rulesText?: string;
  /** 규칙 박스 본문 글자 크기(px). 기본 16 */
  rulesFontSize?: number;
  /** 하단 후원 표 열·총합 표시 옵션 */
  donationTableOptions?: DonationTableColumnsOptions;
};

export type MealMatchSettings = {
  isActive: boolean;
  title: string;
  mode: "team" | "individual";
  targetScore: number;
  teamAName: string;
  teamBName: string;
  teamAMemberIds: string[];
  teamBMemberIds: string[];
};

export type DonorRankingsTheme = {
  top: number;
  /** 헤더에 표시할 제목 문구 */
  titleText: string;
  titleSize: number;
  rowSize: number;
  rankSize: number;
  /** 후원 랭킹 패널 전체 불투명도(0~100) */
  overlayOpacity: number;
  bg: string;
  panelBg: string;
  borderColor: string;
  headerAccountBg: string;
  headerToonBg: string;
  rowEvenBg: string;
  rowOddBg: string;
  rankColor: string;
  nameColor: string;
  amountColor: string;
  /** 칼럼 제목(헤더) 글자색 */
  titleColor: string;
  outlineColor: string;
  /** 텍스트 외곽선 두께(px). 0이면 없음 */
  outlineWidth: number;
  /** OBS 확대(%) — URL이 아니라 관리자 저장값으로 반영 */
  zoomPct: number;
};

export type DonorRankingsPreset = {
  id: string;
  name: string;
  theme: DonorRankingsTheme;
};

/** 후원순위 패널 본문 이미지/GIF 위치 */
export type OverlayBodyImagePosition = "abovePanel" | "belowTitle" | "belowList";

/** 후원 랭킹 엑셀표 등 오버레이 전용 배경(GIF) 설정 */
export type OverlayConfig = {
  /** 배경 GIF 이미지 URL 또는 경로(예: /images/bg/foo.gif) */
  bgGifUrl: string;
  /** 배경 투명도 0~100 */
  bgOpacity: number;
  /** 배경 레이어 사용 여부 */
  isBgEnabled: boolean;
  /** 패널 본문에 표시할 이미지·GIF URL */
  bodyImageUrl: string;
  /** 본문 이미지 투명도 0~100 */
  bodyImageOpacity: number;
  /** 본문 이미지 사용 여부 */
  isBodyImageEnabled: boolean;
  /** 본문 이미지 배치 위치 */
  bodyImagePosition: OverlayBodyImagePosition;
  /** 패널 바깥 PNG 테두리 프레임 URL (중앙 투명) */
  frameUrl: string;
  /** 프레임 불투명도 0~100 */
  frameOpacity: number;
  /** 프레임 안쪽 여백(px) */
  frameInset: number;
  /** PNG 프레임 사용 여부 */
  isFrameEnabled: boolean;
};

/** 단체짠 후원 — 운영비·지정 멤버 제외 후 균등 분배 (기본 전원 분배, excludedMemberIds만 제외) */
export type GroupSplitDonationSettings = {
  /** 분배 대상에서 제외할 멤버 id — 운영비 멤버는 목록과 무관하게 항상 제외 */
  excludedMemberIds: string[];
  /** 후원자명·메시지에 「단체」·「단짠」 등 포함 시 자동 균등 분배 (기본 ON) */
  autoSplitOnKeyword?: boolean;
};

/** 상류사회 땅따먹기 — 총 길이 고정, 멤버 N등분 시작, 양끝만 단방향 */
export type HighSocietyPushDir = "left" | "right" | "split";

/** 상류사회 오버레이 연출 토글 */
export type HighSocietyFxSettings = {
  /** 확장 방향 쪽 전선(경계 빛) */
  frontier: boolean;
  /** 영토가 늘 때 잠식 플래시 */
  growFlash: boolean;
  /** 평평 모드 분쟁 경계선 */
  contestedEdge: boolean;
  /** 화살표 모드 금색 칼날 팁 */
  arrowBlade: boolean;
  /** 강한 텍스트 외곽선 */
  strongOutline: boolean;
};

export type HighSocietySettings = {
  /** 후원 목록에서 상류사회 모드·방향 설정 표시 */
  enabled: boolean;
  /**
   * 좌→우 좌석 멤버 id (순서=전장 배치).
   * 비우면 운영비 제외 전원(로스터 순)이 참가 → N등분.
   */
  seatMemberIds: string[];
  /** 가운데 멤버 기본 확장 방향(후원 행 hsPushDir 없을 때) */
  defaultMiddlePush: HighSocietyPushDir;
  /** @deprecated defaultMiddlePush로 통합 — 하위 호환 */
  defaultBPush?: HighSocietyPushDir;
  /** @deprecated defaultMiddlePush로 통합 — 하위 호환 */
  defaultCPush?: HighSocietyPushDir;
  /** 오버레이 게이지 flat | arrow */
  barStyle?: "flat" | "arrow";
  /** 라운드 번호 표시용 */
  round?: number;
  /** 전장 총 가로(cm) — 멤버 수와 무관하게 고정 */
  fieldCm?: number;
  /**
   * 영토 게이지 갱신 시점
   * - realtime: 계좌·투네 합산이 들어올 때마다 즉시 반영
   * - onRoundEnd: generalTimer 라운드가 끝날 때까지 동결, 종료 후 반영
   */
  territoryUpdateMode?: "realtime" | "onRoundEnd";
  /** 땅따먹기 연출 ON/OFF (기본 전부) */
  fx?: HighSocietyFxSettings;
  /** 좌석 멤버별 후원 연동(ON 시 startedAt 이후만 영토 집계) */
  donationLinks?: Record<string, { active: boolean; startedAt?: number }>;
};

/** `/overlay/sig-rolling` — 이미지/GIF 순환 한 장 항목 */
export type SigRollingItem = {
  id: string;
  /** `/uploads/...` 등 공개 URL */
  url: string;
  /** 카드 하단 표시 텍스트 */
  label: string;
  /** 인벤 가격(원). 고액/저액 밴드 분류용(없으면 0) */
  price?: number;
};

export type SigRollingSettings = {
  items: SigRollingItem[];
  /** @deprecated 전환 연출 제거됨. 하위 호환용으로만 유지(무시됨) */
  fadeMs: number;
  /** GIF가 아닌 정지 이미지·파싱 실패 시 한 장당 표시 시간(ms) */
  staticHoldMs: number;
};

/** 시그 롤링 메타(판매 리스트 기반 통합): 라벨/정렬 순서 */
export type SigRollingMetaEntry = {
  label?: string;
  order?: number;
};

/** 후원·오버레이 금액 표시: full=천원 반올림+구분 / short=만원 축약 */
export type DonorsAmountFormat = "full" | "short";

export type AppState = {
  /** 멤버 목록 */
  members: Member[];
  /** 멤버 직급(직급은 멤버 엔티티와 분리 저장) */
  memberPositions: Record<string, string>;
  /** 직급 표시 방식: 멤버 고정(fixed) / 순위 연동(rankLinked) */
  memberPositionMode: "fixed" | "rankLinked";
  /** 순위 연동 모드에서 사용할 직급 라벨(1위부터 순서대로) */
  rankPositionLabels: string[];
  /** 계좌/투네 후원 순위 오버레이 테마 */
  donorRankingsTheme: DonorRankingsTheme;
  /** @deprecated 후원순위 전체(분홍) 제거 — 저장 호환용 */
  donorRankingsFullTheme: DonorRankingsTheme;
  /** 후원 순위 오버레이 테마 프리셋 목록 */
  donorRankingsPresets: DonorRankingsPreset[];
  /** 현재 선택된 후원 순위 프리셋 ID */
  donorRankingsPresetId?: string;
  /** 후원 원장(멀티탭 병합 대상) */
  donors: Donor[];
  /** 관리자 후원 입력·리스트·오버레이 기본 금액 표기 */
  donorsFormat?: DonorsAmountFormat;
  /** 기여도 수동 조정 로그 */
  contributionLogs: ContributionLog[];
  /** 화장실 수동 기록 로그 */
  restroomLogs: RestroomLog[];
  forbiddenWords: string[];
  missions?: MissionItem[];
  sigInventory: SigItem[];
  /** 시그 판매/보드 완판 시 이미지 오버레이 URL (gif/png/jpg 등) */
  sigSoldOutStampUrl: string;
  /** 멤버별 시그 판매 프리셋(활성화할 시그 id 목록) */
  sigSalesMemberPresets: Record<string, string[]>;
  /** 시그 회전판(서버 랜덤 결과 + 오버레이 애니메이션) */
  rouletteState: RouletteState;
  overlayPresets?: unknown[];
  overlaySettings?: LegacyOverlaySettings;
  /** 멤버별 시그 매치 점수 */
  sigMatch: SigMatchState;
  /** 시그 매치 운영 설정 */
  sigMatchSettings: SigMatchSettings;
  mealBattle: MealBattleState;
  mealMatch: MealMatchState;
  mealMatchSettings: MealMatchSettings;
  /** 방송용 카운트다운 타이머 */
  generalTimer: TimerState;
  /** 대전별 타이머 오버레이 사용 여부 */
  matchTimerEnabled: MatchTimerEnabled;
  /** 일반 타이머 표시 스타일(글자/배경/테두리/형식) */
  timerDisplayStyles: Record<"general", TimerDisplayStyle>;
  /** `/overlay/donor-rankings` 배경 GIF·투명도 */
  donorRankingsOverlayConfig: OverlayConfig;
  /** @deprecated 후원순위 전체(분홍) 제거 — 저장 호환용 */
  donorRankingsFullOverlayConfig: OverlayConfig;
  /** `/overlay/donation-lists` 배경 GIF·투명도(상태 저장 시 Redis와 동기화) */
  donationListsOverlayConfig: OverlayConfig;
  /** 단체짠 후원 분배 — 제외 멤버 등 */
  groupSplitDonationSettings?: GroupSplitDonationSettings;
  /** 상류사회(땅따먹기) — 후원 목록·오버레이 연동 */
  highSocietySettings?: HighSocietySettings;
  /** 시그 판매/회전판에서 제외할 시그 ID 목록 */
  sigSalesExcludedIds: string[];
  /** 후원 동기화 라우팅(중복 반영 방지): none | mealBattle | sigMatch | sigSales */
  donationSyncMode?: "none" | "mealBattle" | "sigMatch" | "sigSales" | "highSociety";
  /** 시그 롤링 오버레이 (`/overlay/sig-rolling`) 이미지 목록·전환 설정 */
  sigRolling: SigRollingSettings;
  /** 시그 롤링 전용 메타(라벨/정렬). 실제 항목 소스는 sigInventory(isRolling=true) 우선 */
  sigRollingMeta?: Record<string, SigRollingMetaEntry>;
  /** 마지막 저장 시각(epoch ms), 원격-로컬 최신성 비교 기준 */
  updatedAt: number;
  /** 후원 순위 오버레이 전용 revision — donors·순위 테마 변경 시만 증가(회전판만 바뀌면 증가 안 함) */
  donorRankingsUpdatedAt?: number;
  /** 정산 리셋 시각(epoch ms) — 이후 구 탭·다른 PC 저장으로 후원·금액 되살림 방지 */
  settlementResetAt?: number;
};

export type SettlementMemberRatioOverrides = Record<
  string,
  {
    accountRatio?: number;
    toonRatio?: number;
  }
>;

export type SettlementMemberResult = {
  memberId: string;
  name: string;
  realName?: string;
  /** 정산 시점 운영비 행 여부(체크박스·이름·직급 중 하나로 판정). 엑셀/가독 텍스트와 계산식 정렬에 사용 */
  operating?: boolean;
  bankName?: string;
  bankAccount?: string;
  accountHolder?: string;
  account: number;
  toon: number;
  /** 부가세 포함 원금(공급가 환산 전). 정산 기록·가독 텍스트용 */
  accountSource?: number;
  toonSource?: number;
  accountRatio: number;
  toonRatio: number;
  accountApplied: number;
  toonApplied: number;
  gross: number;
  fee: number;
  net: number;
};

export type SettlementRecord = {
  id: string;
  title: string;
  createdAt: number;
  accountRatio: number;
  toonRatio: number;
  /** 기존 필드명 유지(실제 의미는 taxRate) */
  feeRate: number;
  /** true면 원금을 부가세 포함 금액으로 보고 공급가(÷(1+vatRate))로 환산 후 수익배분 */
  vatIncluded?: boolean;
  /** 부가세율(기본 10%). vatIncluded일 때만 사용 */
  vatRate?: number;
  members: SettlementMemberResult[];
  totalGross: number;
  totalFee: number;
  totalNet: number;
  /** 정산 시점 멤버별 직급 맵(스냅샷). 직급에「운영비」만 켜 둔 경우 엑셀·요약에서도 운영비 행으로 인식 */
  memberPositionsAtSettlement?: Record<string, string>;
  /** 정산 당시 후원 스냅샷 */
  donors?: Donor[];
  /** true면 국고 멤버를 정산 합계·지급 대상에서 제외(별도 표시) */
  omitTreasuryFromSettlement?: boolean;
  /** true면 전체 정산서 PDF에 국고 50% 행 반영 */
  includeTreasuryInFullStatement?: boolean;
};

export type SettlementDeleteLog = {
  recordId: string;
  title: string;
  createdAt: number;
  deletedAt: number;
  totalNet: number;
  reason?: string;
};

