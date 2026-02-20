export type Member = {
  id: string;
  name: string;
  account: number;
  toon: number;
};

export type DonorTarget = "account" | "toon";

export type Donor = {
  id: string;
  name: string;
  amount: number;
  memberId: string;
  at: number;
  target?: DonorTarget;
};

export type MissionItem = {
  id: string;
  title: string;
  price: string;
  isHot?: boolean;
};

export type OverlaySettings = {
  scale: number;
  memberSize: number;
  totalSize: number;
  dense: boolean;
  anchor: string;
  sumAnchor: string;
  sumFree: boolean;
  sumX: number;
  sumY: number;
  theme: string;
  showMembers: boolean;
  showTotal: boolean;
  showGoal: boolean;
  goal: number;
  goalLabel: string;
  goalWidth: number;
  goalAnchor: string;
  showTicker: boolean;
  showTimer: boolean;
  timerStart: number | null;
  timerAnchor: string;
  showMission: boolean;
  missionAnchor: string;
};

export type AppState = {
  members: Member[];
  donors: Donor[];
  forbiddenWords: string[];
  missions?: MissionItem[];
  overlaySettings?: OverlaySettings;
  updatedAt: number;
};

export const STORAGE_KEY = "excel-broadcast-state-v1";
export const DAILY_LOG_KEY = "excel-broadcast-daily-log-v1";
export const FORBID_EVENTS_KEY = "excel-broadcast-forbid-events-v1";

export function defaultMembers(): Member[] {
  return [
    { id: "m1", name: "멤버1", account: 0, toon: 0 },
    { id: "m2", name: "멤버2", account: 0, toon: 0 },
    { id: "m3", name: "멤버3", account: 0, toon: 0 },
  ];
}

export function defaultOverlaySettings(): OverlaySettings {
  return {
    scale: 1,
    memberSize: 24,
    totalSize: 64,
    dense: false,
    anchor: "tl",
    sumAnchor: "bc",
    sumFree: false,
    sumX: 50,
    sumY: 90,
    theme: "default",
    showMembers: true,
    showTotal: true,
    showGoal: false,
    goal: 0,
    goalLabel: "목표 금액",
    goalWidth: 400,
    goalAnchor: "bc",
    showTicker: false,
    showTimer: false,
    timerStart: null,
    timerAnchor: "tr",
    showMission: false,
    missionAnchor: "br",
  };
}

export function defaultState(): AppState {
  return {
    members: defaultMembers(),
    donors: [],
    forbiddenWords: ["금칙어", "욕설", "비속어"],
    overlaySettings: defaultOverlaySettings(),
    updatedAt: Date.now(),
  };
}

export function parseAmount(input: string | number): number {
  if (typeof input === "number") return Math.max(0, Math.floor(input));
  const extracted = (input || "")
    .replace(/[^\d]/g, "");
  const n = parseInt(extracted || "0", 10);
  return isNaN(n) ? 0 : n;
}

// ex) "3.5" => 35,000 (3만5천원), "2" => 20,000, "2.0" => 20,000
// Only first decimal digit is used as thousands; other characters are ignored.
export function parseTenThousandThousand(input: string | number): number {
  if (typeof input === "number") {
    const intPart = Math.trunc(input);
    const frac = Math.abs(input - intPart);
    const thousandDigit = Math.trunc(frac * 10);
    const value = intPart * 10000 + thousandDigit * 1000;
    return Math.max(0, value);
  }
  const s = (input || "").toString().trim();
  const match = s.replace(/,/g, "").match(/(-?\d+)(?:[.,](\d))?/);
  if (!match) return 0;
  const intPart = parseInt(match[1] || "0", 10);
  const thousandDigit = parseInt(match[2] || "0", 10);
  if (isNaN(intPart) || intPart < 0) return 0;
  const td = isNaN(thousandDigit) || thousandDigit < 0 ? 0 : thousandDigit;
  return intPart * 10000 + td * 1000;
}

export function maskTenThousandThousandInput(input: string): string {
  const s = (input || "").toString().replace(/,/g, "").replace(/[^\d.,]/g, "");
  const m = s.match(/^(\d*)([.,]?)(\d?)/);
  if (!m) return "";
  const i = m[1] || "";
  const sep = m[2] ? "." : "";
  const d = m[3] || "";
  return i + sep + d;
}

export function roundToThousand(n: number): number {
  return Math.round((n || 0) / 1000) * 1000;
}

export function loadState(): AppState {
  if (typeof window === "undefined") return defaultState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const data = JSON.parse(raw) as AppState;
    data.members = data.members || defaultMembers();
    data.donors = data.donors || [];
    data.forbiddenWords = data.forbiddenWords || [];
    data.missions = data.missions || [];
    data.overlaySettings = data.overlaySettings || defaultOverlaySettings();
    return data;
  } catch {
    return defaultState();
  }
}

export function saveState(state: AppState) {
  if (typeof window === "undefined") return;
  try {
    const next = { ...state, updatedAt: Date.now() };
    const json = JSON.stringify(next);
    window.localStorage.setItem(STORAGE_KEY, json);
    fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: json,
    }).catch(() => {});
  } catch {
    // ignore
  }
}

export async function saveStateAsync(state: AppState): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const next = { ...state, updatedAt: Date.now() };
  const json = JSON.stringify(next);
  try { window.localStorage.setItem(STORAGE_KEY, json); } catch {}
  try {
    const res = await fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: json,
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function loadStateFromApi(): Promise<AppState | null> {
  try {
    const res = await fetch(`/api/state?_t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.members) {
      data.members = data.members || defaultMembers();
      data.donors = data.donors || [];
      data.forbiddenWords = data.forbiddenWords || [];
      data.missions = data.missions || [];
      data.overlaySettings = data.overlaySettings || defaultOverlaySettings();
      return data as AppState;
    }
    return null;
  } catch {
    return null;
  }
}

export function totalAccount(state: AppState): number {
  return state.members.reduce((sum, m) => sum + (m.account || 0), 0);
}

export function formatManThousand(n: number): string {
  const safe = Math.max(0, Math.round(n / 1000) * 1000);
  const man = Math.floor(safe / 10000);
  const thousandDigit = Math.floor((safe % 10000) / 1000);
  return thousandDigit ? `${man}.${thousandDigit}` : `${man}`;
}

export function formatChatLine(state: AppState): string {
  const members = state.members
    .map((m) => `${m.name}${formatManThousand(m.account)}(${formatManThousand(m.toon)})`)
    .join(",");
  const accAgg = new Map<string, number>();
  for (const d of state.donors) {
    if ((d.target || "account") === "toon") continue;
    accAgg.set(d.name, (accAgg.get(d.name) || 0) + d.amount);
  }
  const accPairs = Array.from(accAgg.entries()).map(([name, amt]) => `${String(name).replace(/\s+/g, "")}${formatManThousand(amt)}`);
  const accStr = accPairs.length ? ` 후원:${accPairs.join(",")}` : "";
  const total = totalAccount(state);
  return `${members}${accStr} 총합:${formatManThousand(total)}`
    .replace(/\s+,/g, ",")
    .replace(/,\s+/g, ",")
    .trim();
}

export function todaysDateKey(d = new Date()): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

export function appendDailyLog(snapshot: AppState) {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(DAILY_LOG_KEY);
    const logs = raw ? JSON.parse(raw) as Record<string, unknown[]> : {};
    const key = todaysDateKey();
    const entry = {
      at: new Date().toISOString(),
      total: totalAccount(snapshot),
      members: snapshot.members,
      donors: snapshot.donors,
    };
    if (!logs[key]) logs[key] = [];
    (logs[key] as unknown[]).push(entry);
    window.localStorage.setItem(DAILY_LOG_KEY, JSON.stringify(logs));
  } catch {
    // ignore
  }
}

export type DailyLogEntry = {
  at: string;
  total: number;
  members: Member[];
  donors: Donor[];
};

export function loadDailyLog(): Record<string, DailyLogEntry[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(DAILY_LOG_KEY);
    return raw ? JSON.parse(raw) as Record<string, DailyLogEntry[]> : {};
  } catch {
    return {};
  }
}

export function clearDailyLog() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(DAILY_LOG_KEY);
  } catch {
    // ignore
  }
}

export type ForbidEvent = { at: number; author: string; message: string; word: string };
export function appendForbidEvent(ev: ForbidEvent) {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(FORBID_EVENTS_KEY);
    const arr: ForbidEvent[] = raw ? JSON.parse(raw) : [];
    arr.unshift(ev);
    const next = arr.slice(0, 200);
    window.localStorage.setItem(FORBID_EVENTS_KEY, JSON.stringify(next));
  } catch {}
}

export function loadForbidEvents(): ForbidEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(FORBID_EVENTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function confirmHighAmount(amount: number): boolean {
  if (amount >= 1_000_000) {
    return typeof window !== "undefined"
      ? window.confirm("정말 이 금액이 맞습니까?")
      : false;
  }
  return true;
}
