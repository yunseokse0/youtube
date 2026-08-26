/** 계좌·투네(또는 유사 채널) 구분 */
export type DonationAlertTarget = "account" | "toon";

/** 화면에 표시할 후원 알림 1건 */
export type DonationAlertShowItem = {
  id: string;
  donorName: string;
  memberName: string;
  amount: number;
  target: DonationAlertTarget;
  /** 기여도 점수 — 기본: 후원 금액과 1:1 (원=점) */
  contributionPoints: number;
  at: number;
};

export type DonationAlertLabels = {
  accountTarget: string;
  toonTarget: string;
  contribution: string;
};

export const DEFAULT_DONATION_ALERT_LABELS: DonationAlertLabels = {
  accountTarget: "계좌 후원",
  toonTarget: "투네이션 후원",
  contribution: "기여도 점수",
};

export type DonationAlertUrlOptions = {
  test?: boolean;
  /** 기본 `/overlay/donation-alert` — 다른 앱 경로에 맞게 변경 */
  basePath?: string;
  host?: string;
  allowSse?: boolean;
  extraParams?: Record<string, string>;
};

export type DonationMemberRef = { id?: string; name?: string };

export type DonationRecordRef = Record<string, unknown>;

export type DonationAppliedHint = {
  donorName?: string;
  amount?: number;
  target?: string;
  memberName?: string;
};
