export type Member = {
  id: string;
  name: string;
  realName?: string;
  account: number;
  toon: number;
  goal?: number;
  role?: string;
  operating?: boolean;
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

/** 동기화 오류 시 members가 missions에 섞이는 것 방지. title/price가 있는 항목만 반환 */
export function ensureMissionItems(items: unknown[] | undefined | null): MissionItem[] {
  if (!Array.isArray(items)) return [];
  return items.filter((x): x is MissionItem => {
    if (!x || typeof x !== "object") return false;
    const t = x as Record<string, unknown>;
    return typeof t.title === "string" && typeof t.price === "string";
  }).map((x) => ({
    id: String((x as MissionItem).id || ""),
    title: String((x as MissionItem).title || ""),
    price: String((x as MissionItem).price || ""),
    isHot: Boolean((x as MissionItem).isHot),
  }));
}

/** 동기화 오류 시 missions가 members에 섞이는 것 방지. name이 있고 title이 없는 항목만 반환 */
export function ensureMembers(items: unknown[] | undefined | null): Member[] {
  if (!Array.isArray(items)) return [];
  return items.filter((x): x is Member => {
    if (!x || typeof x !== "object") return false;
    const t = x as Record<string, unknown>;
    return typeof t.name === "string" && typeof t.title !== "string";
  }).map((m) => normalizeMember(m as Member));
}

type LegacyOverlaySettings = {
  presets?: unknown[];
  [key: string]: unknown;
};

export type AppState = {
  members: Member[];
  donors: Donor[];
  forbiddenWords: string[];
  missions?: MissionItem[];
  overlayPresets?: unknown[];
  overlaySettings?: LegacyOverlaySettings;
  updatedAt: number;
};

import { sendSSEUpdate } from "./sse-client";

export const STORAGE_KEY = "excel-broadcast-state-v1";
export const DAILY_LOG_KEY = "excel-broadcast-daily-log-v1";
export const FORBID_EVENTS_KEY = "excel-broadcast-forbid-events-v1";
export const MISSIONS_BACKUP_KEY = "excel-broadcast-missions-backup-v1";

export function storageKey(userId?: string | null): string {
  return userId ? `${STORAGE_KEY}:${userId}` : STORAGE_KEY;
}
export function dailyLogStorageKey(userId?: string | null): string {
  return userId ? `${DAILY_LOG_KEY}:${userId}` : DAILY_LOG_KEY;
}
export function missionsBackupKey(userId?: string | null): string {
  return userId ? `${MISSIONS_BACKUP_KEY}:${userId}` : MISSIONS_BACKUP_KEY;
}

export function saveMissionsBackup(missions: MissionItem[], userId?: string | null): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(missionsBackupKey(userId), JSON.stringify(missions));
  } catch {}
}

export function loadMissionsBackup(userId?: string | null): MissionItem[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(missionsBackupKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed as MissionItem[];
  } catch {
    return null;
  }
}

export function defaultMembers(): Member[] {
  return [
    { id: "m1", name: "멤버1", realName: "", account: 0, toon: 0, role: "", operating: false },
    { id: "m2", name: "멤버2", realName: "", account: 0, toon: 0, role: "", operating: false },
    { id: "m3", name: "멤버3", realName: "", account: 0, toon: 0, role: "", operating: false },
  ];
}

function normalizeMember(m: Member): Member {
  const goal = typeof m.goal === "number" && Number.isFinite(m.goal) ? Math.max(0, Math.floor(m.goal)) : undefined;
  return {
    ...m,
    realName: m.realName ?? "",
    goal,
    role: m.role ?? "",
    operating: m.operating ?? (/운영비/i.test(m.name) || /운영비/i.test(m.role || "")),
  };
}

export function defaultState(): AppState {
  return {
    members: defaultMembers(),
    donors: [],
    forbiddenWords: ["금칙어", "욕설", "비속어"],
    overlayPresets: [],
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

export function loadState(userId?: string | null): AppState {
  if (typeof window === "undefined") return defaultState();
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return defaultState();
    const data = JSON.parse(raw) as AppState;
    data.members = (() => { const v = ensureMembers(data.members); return v.length > 0 ? v : defaultMembers().map(normalizeMember); })();
    data.donors = data.donors || [];
    data.forbiddenWords = data.forbiddenWords || [];
    data.missions = ensureMissionItems(data.missions);
    data.overlayPresets = Array.isArray(data.overlayPresets)
      ? data.overlayPresets
      : Array.isArray(data.overlaySettings?.presets)
        ? data.overlaySettings?.presets
        : [];
    return data;
  } catch {
    return defaultState();
  }
}

export function saveState(state: AppState, userId?: string | null) {
  if (typeof window === "undefined") return;
  try {
    const next = { ...state, updatedAt: Date.now() };
    const json = JSON.stringify(next);
    window.localStorage.setItem(storageKey(userId), json);
    const q = new URLSearchParams();
    if (userId) q.set("user", userId);
    const url = q.toString() ? `/api/state?${q.toString()}` : "/api/state";
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: json,
      credentials: "include",
    }).catch(() => {});
    try {
      const { sendSSEUpdate } = require("./sse-post") as { sendSSEUpdate: (d: unknown) => Promise<void> };
      void sendSSEUpdate(next);
    } catch {}
  } catch {
    // ignore
  }
}

export async function saveStateAsync(state: AppState, userId?: string | null): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const next = { ...state, updatedAt: Date.now() };
  const json = JSON.stringify(next);
  try { window.localStorage.setItem(storageKey(userId), json); } catch {}
  try {
    const q = new URLSearchParams();
    if (userId) q.set("user", userId);
    const url = q.toString() ? `/api/state?${q.toString()}` : "/api/state";
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: json,
      credentials: "include",
    });
    try {
      const { sendSSEUpdate } = require("./sse-post") as { sendSSEUpdate: (d: unknown) => Promise<void> };
      void sendSSEUpdate(next);
    } catch {}
    return res.ok;
  } catch {
    return false;
  }
}

export async function loadStateFromApi(userId?: string): Promise<AppState | null> {
  try {
    const q = new URLSearchParams({ _t: String(Date.now()) });
    if (userId) q.set("user", userId);
    const res = await fetch(`/api/state?${q.toString()}`, { cache: "no-store", credentials: "include" });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.members) {
      data.members = (() => { const v = ensureMembers(data.members); return v.length > 0 ? v : defaultMembers().map(normalizeMember); })();
      data.donors = data.donors || [];
      data.forbiddenWords = data.forbiddenWords || [];
      data.missions = ensureMissionItems(data.missions);
      data.overlayPresets = Array.isArray(data.overlayPresets)
        ? data.overlayPresets
        : Array.isArray(data.overlaySettings?.presets)
          ? data.overlaySettings?.presets
          : [];
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

export function totalToon(state: AppState): number {
  return state.members.reduce((sum, m) => sum + (m.toon || 0), 0);
}

export function totalCombined(state: AppState): number {
  return totalAccount(state) + totalToon(state);
}

/** 서버/동기화 시 기본값으로 덮어쓰기 방지: remote가 기본 상태처럼 보이는지 확인 */
export function isDefaultLikeState(state: AppState): boolean {
  const def = defaultMembers();
  const m = state.members || [];
  if (m.length !== def.length) return false;
  const allDefaultNames = m.every((mm, i) => mm.id === def[i].id && mm.name === def[i].name);
  const noData = totalCombined(state) === 0 && (!state.donors || state.donors.length === 0);
  return allDefaultNames && noData;
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

export function appendDailyLog(snapshot: AppState, userId?: string | null) {
  if (typeof window === "undefined") return;
  try {
    const storageKeyForLog = dailyLogStorageKey(userId);
    const raw = window.localStorage.getItem(storageKeyForLog);
    const logs = raw ? (JSON.parse(raw) as Record<string, unknown[]>) : {};
    const dateKey = todaysDateKey();
    const entry = {
      at: new Date().toISOString(),
      total: totalAccount(snapshot),
      members: snapshot.members,
      donors: snapshot.donors,
    };
    if (!logs[dateKey]) logs[dateKey] = [];
    (logs[dateKey] as unknown[]).push(entry);
    const merged = JSON.stringify(logs);
    window.localStorage.setItem(storageKeyForLog, merged);
    // 서버에 동기화: 기존 서버 데이터와 병합 후 저장 (실패 시 로컬만 유지)
    const q = new URLSearchParams();
    if (userId) q.set("user", userId);
    const baseUrl = q.toString() ? `/api/daily-log?${q.toString()}` : "/api/daily-log";
    fetch(baseUrl, { cache: "no-store", credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((serverLog: Record<string, unknown[]> | null) => {
        let toSave: Record<string, unknown[]>;
        if (serverLog && typeof serverLog === "object") {
          toSave = { ...serverLog };
          if (!toSave[dateKey]) toSave[dateKey] = [];
          (toSave[dateKey] as unknown[]).push(entry);
        } else {
          toSave = JSON.parse(merged) as Record<string, unknown[]>;
        }
        return fetch(baseUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(toSave),
        });
      })
      .catch(() => {});
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

export function loadDailyLog(userId?: string | null): Record<string, DailyLogEntry[]> {
  if (typeof window === "undefined") return {};
  try {
    let raw = window.localStorage.getItem(dailyLogStorageKey(userId));
    if (!raw && userId) {
      raw = window.localStorage.getItem(DAILY_LOG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, DailyLogEntry[]>;
        if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) {
          window.localStorage.setItem(dailyLogStorageKey(userId), raw);
          return parsed;
        }
      }
    }
    return raw ? (JSON.parse(raw) as Record<string, DailyLogEntry[]>) : {};
  } catch {
    return {};
  }
}

export async function loadDailyLogFromApi(userId?: string | null): Promise<Record<string, DailyLogEntry[]>> {
  if (typeof window === "undefined") return {};
  try {
    const q = new URLSearchParams({ _t: String(Date.now()) });
    if (userId) q.set("user", userId);
    const res = await fetch(`/api/daily-log?${q.toString()}`, {
      cache: "no-store",
      credentials: "include",
    });
    if (!res.ok) return {};
    const data = await res.json();
    if (data && typeof data === "object") return data as Record<string, DailyLogEntry[]>;
    return {};
  } catch {
    return {};
  }
}

export function clearDailyLog(userId?: string | null) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(dailyLogStorageKey(userId));
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
