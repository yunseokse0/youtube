import { gzip, ungzip } from "pako";
import {
  isPersistentKvConfigured,
  upstashGetJson,
  upstashSetJsonWithPipeline,
} from "./upstash";

const GZIP_MARKER = "__gzipB64";

type GzipEnvelope = { [GZIP_MARKER]: string };

function isGzipEnvelope(v: unknown): v is GzipEnvelope {
  return Boolean(v && typeof v === "object" && typeof (v as GzipEnvelope)[GZIP_MARKER] === "string");
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function isUpstashAppStateGzipEnabled(): boolean {
  const v = String(process.env.UPSTASH_STATE_GZIP ?? "").trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off") return false;
  if (v === "1" || v === "true" || v === "on") return true;
  /** Render 프로덕션 기본 on — Service-Initiated(Upstash 왕복) 절감 */
  return process.env.RENDER === "true" && process.env.NODE_ENV === "production";
}

function minBytesForGzip(): number {
  const raw = String(process.env.UPSTASH_STATE_GZIP_MIN_BYTES ?? "8192").trim();
  const n = parseInt(raw.replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : 8192;
}

export async function upstashGetAppStateJson<T = unknown>(key: string): Promise<T | null> {
  const raw = await upstashGetJson<T | GzipEnvelope>(key);
  if (!raw) return null;
  if (!isGzipEnvelope(raw)) return raw as T;
  try {
    const json = new TextDecoder().decode(ungzip(base64ToBytes(raw[GZIP_MARKER])));
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

/**
 * 정산표(앱 상태) 키는 저장이 실패해도 버리지 않는다 — 메모리엔 이미 들어간 후원이
 * MySQL 에 없으면 재시작 때 사라진다. 실패하면 그 키의 마지막 값을 성공할 때까지 다시 쓴다.
 * 더 새 값이 저장 요청되면 그 값이 우선이고, 옛 값은 다시 쓰지 않는다.
 */
const RETRY_UNTIL_SAVED_KEY_PREFIX = "excel-broadcast-state-v1:";
const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 10_000;

type PendingAppStateWrite = { seq: number; value: unknown };

const writeSeqByKey = new Map<string, number>();
const pendingByKey = new Map<string, PendingAppStateWrite>();
const retryTimerByKey = new Map<string, ReturnType<typeof setTimeout>>();
const retryAttemptsByKey = new Map<string, number>();

function isRetryUntilSavedKey(key: string): boolean {
  return key.startsWith(RETRY_UNTIL_SAVED_KEY_PREFIX);
}

function scheduleAppStateRetry(key: string): void {
  if (retryTimerByKey.has(key)) return;
  const attempt = (retryAttemptsByKey.get(key) || 0) + 1;
  retryAttemptsByKey.set(key, attempt);
  const delay = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
  const timer = setTimeout(() => {
    retryTimerByKey.delete(key);
    const pending = pendingByKey.get(key);
    if (!pending || writeSeqByKey.get(key) !== pending.seq) return;
    void upstashSetAppStateJson(key, pending.value);
  }, delay);
  retryTimerByKey.set(key, timer);
}

function settleAppStateWrite(key: string, seq: number, value: unknown, ok: boolean): void {
  const pending = pendingByKey.get(key);
  if (ok) {
    if (pending && pending.seq <= seq) {
      pendingByKey.delete(key);
      const attempts = retryAttemptsByKey.get(key) || 0;
      retryAttemptsByKey.delete(key);
      console.info(`[app-state] saved after ${attempts} retr${attempts === 1 ? "y" : "ies"} key=${key}`);
    }
    return;
  }
  if (writeSeqByKey.get(key) !== seq) return;
  if (!pending) console.warn(`[app-state] save failed — retrying until saved key=${key}`);
  pendingByKey.set(key, { seq, value });
  scheduleAppStateRetry(key);
}

/** 진단·테스트 — 아직 저장소에 못 쓴 정산표 키 수 */
export function getPendingAppStateWriteCount(): number {
  return pendingByKey.size;
}

export async function upstashSetAppStateJson(key: string, value: unknown): Promise<boolean> {
  if (!isPersistentKvConfigured()) return false;
  if (!isRetryUntilSavedKey(key)) return writeAppStateJsonOnce(key, value);
  const seq = (writeSeqByKey.get(key) || 0) + 1;
  writeSeqByKey.set(key, seq);
  const ok = await writeAppStateJsonOnce(key, value).catch(() => false);
  settleAppStateWrite(key, seq, value, ok);
  return ok;
}

async function writeAppStateJsonOnce(key: string, value: unknown): Promise<boolean> {
  const json = JSON.stringify(value);
  if (!isUpstashAppStateGzipEnabled() || json.length < minBytesForGzip()) {
    return upstashSetJsonWithPipeline(key, value);
  }
  try {
    const gz = gzip(json);
    const envelope: GzipEnvelope = { [GZIP_MARKER]: bytesToBase64(gz) };
    return upstashSetJsonWithPipeline(key, envelope);
  } catch {
    return upstashSetJsonWithPipeline(key, value);
  }
}
