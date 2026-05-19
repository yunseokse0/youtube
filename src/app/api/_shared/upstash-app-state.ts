import { gzip, ungzip } from "pako";
import { getRedisEnv, upstashGetJson, upstashSetJsonWithPipeline } from "./upstash";

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

export async function upstashSetAppStateJson(key: string, value: unknown): Promise<boolean> {
  const { base, token } = getRedisEnv();
  if (!base || !token) return false;
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
