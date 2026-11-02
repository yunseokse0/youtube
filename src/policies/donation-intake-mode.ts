export const DONATION_INTAKE_ENV_KEY = "TOONA_INTAKE_MODE";
export const DONATION_INTAKE_ENV_KEY_ALT = "DONATION_INTAKE_MODE";
export const DONATION_INTAKE_RUNTIME_KV_PREFIX = "din:runtime:intake-mode";

/**
 * KV (Upstash/MySQL) 다운·미설치시 프로세스 생존 동안 모드를 기억하는 인메모리 Fallback.
 * Safety Net: 프로덕션 배포 직후나 KV 장애시에도 모드 전환이 즉시 동작하도록.
 */
type InMemoryModeRecord = { mode: DonationIntakeMode; updatedAt: number };
const inMemoryRuntimeMode = new Map<string, InMemoryModeRecord>();

/** BOTH/A 타입은 하위 호환용 — 런타임은 항상 B만 사용 */
export type DonationIntakeMode = "A" | "B" | "BOTH";

export const DONATION_INTAKE_MODE_A: DonationIntakeMode = "A";
export const DONATION_INTAKE_MODE_B: DonationIntakeMode = "B";
export const DONATION_INTAKE_MODE_BOTH: DonationIntakeMode = "BOTH";

/**
 * ✅ 사용자 정의 모드 정리 (2026-09-06 VERBATIM)
 *
 *  A 모드 (= 투네 직접 연결 모드, Toonation Direct):
 *    - 후원 출처: Toonation (투네) 브라우저 WS 릴레이 / OBS 직접 WS
 *    - 처리 경로: /api/donations/toonation/ingest
 *    - DIN 허브 폴러 / DONATIONS_INGEST 는 사용 안함
 *
 *  B 모드 (= DIN 허브 연결 모드, DIN Hub · Toona Project):
 *    - 후원 출처: DIN 허브에 등록된 투나(Toona) 프로젝트 후원만 가져옴
 *    - 처리 경로: /api/donations/ingest (TOONA_INGEST_SECRET Bearer 인증)
 *             + instrumentation b-mode poller 가 hub 자동 폴&드레인
 *    - Toonation 직접 WS 리스너는 시작하지 않음
 *
 * ★ 2026-11-02: 운영은 B모드만 사용.
 *   env·KV·요청에 A/BOTH가 남아 있어도 후원 유입은 B(DIN 허브)만 연다.
 */

/**
 * 2026-11-02: A/BOTH(투네 직접·병행)는 쓰지 않는다.
 * env·KV에 A/BOTH가 남아 있어도 후원 유입은 B(DIN 허브)만 연다.
 */
export function getDonationIntakeEnvFallbackMode(): DonationIntakeMode {
  return DONATION_INTAKE_MODE_B;
}

/** 하위 호환용 (사용처 전부 그대로 동작하지만, userId 넘길 수 있을때는 Runtime 함수 쓰세요) */
export function getDonationIntakeMode(): DonationIntakeMode {
  return getDonationIntakeEnvFallbackMode();
}

/** 후원 유입은 B만. 저장값·env가 A/BOTH여도 B를 돌려준다. */
export async function getRuntimeDonationIntakeMode(
  _userId: string | null | undefined
): Promise<DonationIntakeMode> {
  return DONATION_INTAKE_MODE_B;
}

/**
 * user별 Runtime 모드 KV에 저장. 저장 성공 여부 boolean 리턴.
 * Safety Net: 영구 저장소(KV) 실패해도 인메모리에는 반드시 저장 → 최소한 현 프로세스에서 적용은 보장
 * ★ 항상 B로 정규화해 저장한다.
 */
export async function setRuntimeDonationIntakeMode(
  userId: string | null | undefined,
  _mode: DonationIntakeMode
): Promise<boolean> {
  if (!userId || !String(userId).trim()) return false;
  const normalizedMode = DONATION_INTAKE_MODE_B;
  const memoKey = `${String(userId).trim()}`;
  const nowTs = Date.now();
  /** 인메모리에 먼저 저장 (영구 저장 실패해도 현 프로세스에서는 적용 보장) */
  inMemoryRuntimeMode.set(memoKey, { mode: normalizedMode, updatedAt: nowTs });

  const key = `${DONATION_INTAKE_RUNTIME_KV_PREFIX}:${memoKey}`;
  const payload = {
    mode: normalizedMode,
    updatedAt: nowTs,
  };
  try {
    const { upstashSetJsonWithSetPath } = await import("@/app/api/_shared/upstash");
    const saved = await upstashSetJsonWithSetPath(key, payload);
    return saved !== false;
  } catch {
    return false;
  }
}

export function isDonationIntakeModeA(): boolean {
  return false;
}

export function isDonationIntakeModeB(): boolean {
  return true;
}

export async function isRuntimeDonationIntakeModeA(
  _userId: string | null | undefined
): Promise<boolean> {
  return false;
}

export async function isRuntimeDonationIntakeModeB(
  _userId: string | null | undefined
): Promise<boolean> {
  return true;
}

export function describeDonationIntakeMode(): string {
  return `B모드 (DIN 허브 모드 · Toona Project Hub)`;
}

export function describeDonationIntakeModeShort(mode: DonationIntakeMode): string {
  if (mode === "A") return "A · 투네이션 자동";
  if (mode === "BOTH") return "A+B 병행";
  return "B · DIN 허브 모드";
}

export function describeRuntimeDonationIntakeModeByMode(
  mode: DonationIntakeMode
): string {
  if (mode === "A") {
    return `A모드 (투네이션 직접 WebSocket 자동 연결 · 투네이션 링크만 넣으면 OK)`;
  }
  if (mode === "BOTH") {
    return "A+B 모드 (투네 WS + DIN 허브 양 경로 병행 · dedupHash 중복 차단)";
  }
  return `B모드 (DIN 허브 모드 · DIN 허브 로그인 후 30초/60초 자동 폴링)`;
}
