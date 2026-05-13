export type DonationProvider = "toonation" | "bank";

export interface DonationEvent {
  id: string;
  provider: DonationProvider;
  externalId: string;
  donorName: string;
  amount: number;
  message?: string;
  at: string;
  target?: "account" | "toon";
  status: "queued" | "processed" | "failed" | "unmatched";
  memberId?: string;
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
