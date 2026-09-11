import type { ContributionFormula } from "@/types";

export type DonationProvider = "toonation" | "bank";

export interface DonationEvent {
  id: string;
  provider: DonationProvider;
  externalId: string;
  donorName: string;
  /** ✅ 2026-09-11 Hotfix P0: 계좌/SMS 후원 건별 고유 키 — 동일인 동일금액 연속후원 중복 방지용 */
  donorKey?: string | number;
  /** ✅ 2026-09-11 Hotfix P0: DB 저장 기본키 (저장 round-trip 후 unique 식별) */
  primaryKey?: string | number;
  /** ✅ 2026-09-11 Hotfix P0: 익명 랜덤명 등 최종 표시용 displayName */
  displayName?: string;
  /** ✅ 2026-09-11 Hotfix P0: 소스에서 발급한 그대로의 rawId (정규화 전) */
  rawId?: string;
  /** ✅ 2026-09-11 Hotfix P0: 컨텐츠 기반 signature 해시 — dedupe 버킷 충돌 방지 */
  rawHash?: string;
  /** 메시지에서 파싱한 플레이어(멤버) 이름 — 엑셀 행 매칭 */
  playerName?: string;
  /** @deprecated playerName 우선 — 하위 호환 */
  recipientName?: string;
  amount: number;
  message?: string;
  at: string;
  target?: "account" | "toon";
  status: "queued" | "processed" | "failed" | "unmatched";
  memberId?: string;
  /** 투네 후원: 플레이어 미지정으로 기본 멤버에 배치됨 — 관리자 확인용 */
  memberAutoAssigned?: boolean;
  /** 유사 일치(완화 fuzzy)로 멤버 자동 매칭됨 */
  memberFuzzyMatched?: boolean;
  /** 서버 자동 반영 완료 후 큐 모니터링용(재승인 시 중복 방지) */
  alreadyApplied?: boolean;
  /** 관리자 미매칭 수동 배치 — 드롭다운에서 고른 멤버에 강제 적립 */
  manualAssignMemberId?: string;
  /** 상류사회 B·C 확장 방향 */
  hsPushDir?: "left" | "right" | "split";
  error?: string;
  sigListSnapshot?: QueueSigItem[];
  /** 금액·텍스트 매칭(또는 리롤판 백업)으로 추정한 시그명 — 플레이어 팝업용 */
  matchedSigName?: string;
  /** 매칭 시그 인벤 imageUrl (OBS에서 resolveSigOverlayCardImageUrl로 표시) */
  matchedSigImageUrl?: string;
  /** 금액·메시지로 단일 시그에 확정 매칭됨 */
  isAutoMatched?: boolean;
  /** toona ingest — 이미 계산된 기여도 점수(엑셀표·donors 저장용) */
  contributionPoints?: number;
  /** toona ingest — 기여도 가중치(상태 formula 갱신·apply 계산용) */
  contributionFormula?: ContributionFormula;
  /** Fix⑲: DIN 3초 Aggregator bucket 압축 해제용 메타데이터 — DB donors에는 Bucket Per Row로 1건만 적재하되 Alert 개별 발송은 N회 */
  aggregatedCount?: number;
  /** Aggregator bucket에 포함된 원본 개별 이벤트 ID 목록 (중복 차단·로그 추적용) */
  aggregatedEventIds?: string[];
  /** Aggregator bucket donor 목록 (중복 제거된 unique donorName 배열 — C Donor 패턴은 길이=1) */
  aggregatedDonors?: string[];
  /** Aggregator bucket 메시지 목록 (최대 N개 샘플링) */
  aggregatedMessages?: string[];
  /** Aggregator bucket playerName 목록 (unique 배열) */
  aggregatedPlayers?: string[];
  /** Aggregator bucket 첫 이벤트 발생 시각 (버킷 시작 시점) */
  firstAt?: string;
}

export interface Donor {
  id: string;
  name: string;
  amount: number;
  memberId: string;
  at: string;
  target?: "account" | "toon";
  message?: string;
}

export interface DonorAlias {
  alias: string;
  memberId: string;
}

export interface QueueSigItem {
  id: string;
  name: string;
  price: number;
  isActive: boolean;
  soldCount?: number;
  maxCount?: number;
  imageUrl?: string;
}
