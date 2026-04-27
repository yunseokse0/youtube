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
  phase?: "IDLE" | "SPINNING" | "LANDED" | "CONFIRM_PENDING" | "CONFIRMED";
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
  /** 최근 세션 식별자 */
  sessionId?: string;
  /** 최근 확정 로그 */
  lastFinishedAt?: number;
  /** 최근 이력 스냅샷(최대 50) */
  historyLogs?: Array<{
    id: string;
    sessionId: string;
    phase: "CONFIRMED" | "CANCELLED";
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

export type MealBattleState = {
  participants: MealBattleParticipant[];
  /** 참가 체크 전에도 멤버별 게이지 색 지정(참가 시 participant.color로 사용) */
  memberGaugeColors: Record<string, string>;
  /** 상단 큰 제목 */
  overlayTitle: string;
  /** 보라 말풍선(미션/서브 문구) */
  currentMission: string;
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
};

export type TimerState = {
  remainingTime: number;
  isActive: boolean;
  lastUpdated: number;
};

export type TimerDisplayStyle = {
  showHours: boolean;
  fontColor: string;
  bgColor: string;
  borderColor: string;
  bgOpacity: number;
};

/** 시그 매치 / 식사 매치 / 시그 판매 / 일반 타이머를 오버레이에서 쓸지 여부 */
export type MatchTimerEnabled = {
  sigMatch: boolean;
  mealMatch: boolean;
  sigSales: boolean;
  /** 방송용 자유 타이머(매치와 무관) */
  general: boolean;
};

/** 시그 n:n 규칙: 같은 풀에 속한 멤버는 시그 1건을 풀 인원 수로 나눠 동일 반영. 풀에 없는 멤버는 1:1(후원 건의 memberId만). */
export type SigMatchPool = {
  id: string;
  memberIds: string[];
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
  /** count 모드에서 포인트→정산 환산 단가 */
  incentivePerPoint: number;
  /**
   * n:n 풀 목록(2명 이상만 유효). 비어 있으면 전원 1:1.
   * 한 멤버는 한 풀에만 속할 수 있음(먼저 정의된 풀 우선).
   */
  sigMatchPools: SigMatchPool[];
  /**
   * 랭킹·오버레이에 표시·집계할 멤버 id 목록.
   * 비어 있으면 전원. 하나 이상이면 해당 멤버만 대전에 포함(나머지는 목록에서 제외).
   */
  participantMemberIds: string[];
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
  outlineColor: string;
};

export type DonorRankingsPreset = {
  id: string;
  name: string;
  theme: DonorRankingsTheme;
};

/** 후원 랭킹 엑셀표 등 오버레이 전용 배경(GIF) 설정 */
export type OverlayConfig = {
  /** 배경 GIF 이미지 URL 또는 경로(예: /images/bg/foo.gif) */
  bgGifUrl: string;
  /** 배경 투명도 0~100 */
  bgOpacity: number;
  /** 배경 레이어 사용 여부 */
  isBgEnabled: boolean;
};

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
  /** 후원 순위 오버레이 테마 프리셋 목록 */
  donorRankingsPresets: DonorRankingsPreset[];
  /** 현재 선택된 후원 순위 프리셋 ID */
  donorRankingsPresetId?: string;
  /** 후원 원장(멀티탭 병합 대상) */
  donors: Donor[];
  /** 기여도 수동 조정 로그 */
  contributionLogs: ContributionLog[];
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
  sigMatchTimer: TimerState;
  mealMatchTimer: TimerState;
  sigSalesTimer: TimerState;
  /** 매치와 별도의 일반 카운트다운 타이머 */
  generalTimer: TimerState;
  /** 대전별 타이머 오버레이 사용 여부 */
  matchTimerEnabled: MatchTimerEnabled;
  /** 타이머 유형별 표시 스타일(글자/배경/테두리/형식) */
  timerDisplayStyles: Record<"sigMatch" | "mealMatch" | "sigSales" | "general", TimerDisplayStyle>;
  /** `/overlay/donor-rankings` 배경 GIF·투명도 */
  donorRankingsOverlayConfig: OverlayConfig;
  /** `/overlay/donation-lists` 배경 GIF·투명도(상태 저장 시 Redis와 동기화) */
  donationListsOverlayConfig: OverlayConfig;
  /** 시그 판매/회전판에서 제외할 시그 ID 목록 */
  sigSalesExcludedIds: string[];
  /** 마지막 저장 시각(epoch ms), 원격-로컬 최신성 비교 기준 */
  updatedAt: number;
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
  bankName?: string;
  bankAccount?: string;
  accountHolder?: string;
  account: number;
  toon: number;
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
  members: SettlementMemberResult[];
  totalGross: number;
  totalFee: number;
  totalNet: number;
  /** 정산 당시 후원 스냅샷 */
  donors?: Donor[];
};

export type SettlementDeleteLog = {
  recordId: string;
  title: string;
  createdAt: number;
  deletedAt: number;
  totalNet: number;
  reason?: string;
};

