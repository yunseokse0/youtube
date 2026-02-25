export type Member = {
  id: string;
  name: string;
  account: number;
  toon: number;
  today: number;
  missions?: string[];
};

export type Donor = {
  id: string;
  name: string;
  amount: number;
  memberId: string;
  target: "account" | "toon";
  at: number;
  message?: string;
};

export type ForbidEvent = {
  at: number;
  word: string;
  author: string;
  message: string;
};

export type MissionItem = {
  id: string;
  title: string;
  price: number;
  isHot: boolean;
};

export type OverlayElementPosition = {
  x: string;
  y: string;
  width?: string;
  height?: string;
};

export type OverlayPreset = {
  id: string;
  name: string;
  scale: string;
  memberSize: string;
  totalSize: string;
  dense: boolean;
  anchor: string;
  sumAnchor: string;
  sumFree: boolean;
  sumX: string;
  sumY: string;
  theme: string;
  showMembers: boolean;
  showTotal: boolean;
  showGoal: boolean;
  goal: string;
  goalLabel: string;
  goalWidth: string;
  goalAnchor: string;
  showTicker: boolean;
  showTimer: boolean;
  timerStart: number | null;
  timerAnchor: string;
  showMission: boolean;
  missionAnchor: string;
  // 개별 요소 위치 설정
  memberPosition?: OverlayElementPosition;
  totalPosition?: OverlayElementPosition;
};

export type OverlaySettings = {
  scale: string;
  memberSize: string;
  totalSize: string;
  dense: boolean;
  anchor: string;
  sumAnchor: string;
  sumFree: boolean;
  sumX: string;
  sumY: string;
  theme: string;
  showMembers: boolean;
  showTotal: boolean;
  showGoal: boolean;
  goal: string;
  goalLabel: string;
  goalWidth: string;
  goalAnchor: string;
  showTicker: boolean;
  showTimer: boolean;
  timerStart: number | null;
  timerAnchor: string;
  showMission: boolean;
  missionAnchor: string;
  presets?: OverlayPreset[];
};

export type AppState = {
  members: Member[];
  donors: Donor[];
  forbiddenWords: string[];
  overlaySettings?: OverlaySettings;
  updatedAt: number;
};

export const STORAGE_KEY = "excel-broadcast-state-v1";
export const DAILY_LOG_KEY = "excel-broadcast-daily-log-v1";
export const FORBID_EVENTS_KEY = "excel-broadcast-forbid-events-v1";

export function defaultMembers(): Member[] {
  return [
    { id: "m1", name: "멤버1", account: 0, toon: 0, today: 0 },
    { id: "m2", name: "멤버2", account: 0, toon: 0, today: 0 },
    { id: "m3", name: "멤버3", account: 0, toon: 0, today: 0 },
  ];
}

export function defaultState(): AppState {
  return {
    members: defaultMembers(),
    donors: [],
    forbiddenWords: [],
    updatedAt: Date.now(),
  };
}

export function totalAccount(state: AppState): number {
  return state.members.reduce((sum, m) => sum + m.account, 0);
}

export function totalToon(state: AppState): number {
  return state.members.reduce((sum, m) => sum + m.toon, 0);
}

export function saveState(state: AppState) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

export async function loadState(): Promise<AppState> {
  if (typeof window === "undefined") return defaultState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as AppState;
    return parsed.members ? parsed : defaultState();
  } catch {
    return defaultState();
  }
}

export function appendDailyLog(name: string, amount: number) {
  if (typeof window === "undefined") return;
  try {
    const key = `${DAILY_LOG_KEY}-${new Date().toISOString().slice(0, 10)}`;
    const existing = JSON.parse(localStorage.getItem(key) || "[]") as Array<{ name: string; amount: number; at: number }>;
    existing.push({ name, amount, at: Date.now() });
    localStorage.setItem(key, JSON.stringify(existing));
  } catch {}
}

export function parseTenThousandThousand(input: string): number {
  const cleaned = input.replace(/[^\d]/g, "");
  return cleaned ? parseInt(cleaned, 10) : 0;
}

export function maskTenThousandThousandInput(input: string): string {
  const cleaned = input.replace(/[^\d]/g, "");
  return cleaned ? parseInt(cleaned, 10).toLocaleString() : "";
}

export function confirmHighAmount(amount: number): boolean {
  if (amount >= 1000000) {
    return confirm(`${amount.toLocaleString()}원은 큰 금액입니다. 계속하시겠습니까?`);
  }
  return true;
}

export function formatChatLine(author: string, amount: number, message?: string): string {
  return `${author}: ${amount.toLocaleString()}원${message ? ` - ${message}` : ""}`;
}

export function appendForbidEvent(word: string, author: string, message: string) {
  if (typeof window === "undefined") return;
  try {
    const key = FORBID_EVENTS_KEY;
    const existing = JSON.parse(localStorage.getItem(key) || "[]") as ForbidEvent[];
    existing.push({ word, author, message, at: Date.now() });
    localStorage.setItem(key, JSON.stringify(existing.slice(-100))); // Keep last 100 events
  } catch {}
}

export function loadForbidEvents(): ForbidEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const key = FORBID_EVENTS_KEY;
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}