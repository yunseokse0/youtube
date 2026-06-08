export type DonationProvider = "toonation" | "bank";

export interface DonationEvent {
  id: string;
  provider: DonationProvider;
  externalId: string;
  donorName: string;
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
  /** 서버 자동 반영 완료 후 큐 모니터링용(재승인 시 중복 방지) */
  alreadyApplied?: boolean;
  /** 관리자 미매칭 수동 배치 — 드롭다운에서 고른 멤버에 강제 적립 */
  manualAssignMemberId?: string;
  error?: string;
  sigListSnapshot?: QueueSigItem[];
}

export interface Donor {
  id: string;
  name: string;
  amount: number;
  memberId: string;
  at: string;
  target?: "account" | "toon";
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
}
