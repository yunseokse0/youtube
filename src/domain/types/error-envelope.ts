export type LayerTag = "domain" | "infra" | "policies" | "shell" | "presentation";

export interface ErrorEnvelopeData {
  code: string;
  message: string;
  layer: LayerTag;
  cause?: unknown;
  meta?: Record<string, unknown>;
}

export class ErrorEnvelope extends Error {
  code: string;
  layer: LayerTag;
  cause?: unknown;
  meta?: Record<string, unknown>;

  constructor(data: ErrorEnvelopeData) {
    super(data.message);
    this.name = "ErrorEnvelope";
    this.code = data.code;
    this.layer = data.layer;
    this.cause = data.cause;
    this.meta = data.meta;
  }
}

export function makeErrEnvelope(
  code: string,
  message: string,
  layer: LayerTag,
  opts: { cause?: unknown; meta?: Record<string, unknown> } = {},
): ErrorEnvelope {
  return new ErrorEnvelope({
    code,
    message,
    layer,
    cause: opts.cause,
    meta: opts.meta,
  });
}

/** STATE 001: 상태 객체의 형식이 유효하지 않음 */
export const DIN_STATE_001 = "DIN_STATE_001" as const;
/** STATE 002: 상태 진입 시 제약조건 위반 */
export const DIN_STATE_002 = "DIN_STATE_002" as const;
/** STATE 003: 상태 복구 시도 실패 */
export const DIN_STATE_003 = "DIN_STATE_003" as const;
/** STATE 004: 중복 제거 로직 실패 */
export const DIN_STATE_004 = "DIN_STATE_004" as const;
/** STATE 005: ZeroWipe 패턴 의심 */
export const DIN_STATE_005 = "DIN_STATE_005" as const;
/** STATE 006: 타임스탬프 강제 증가(BumpTs) 발생 */
export const DIN_STATE_006 = "DIN_STATE_006" as const;
/** STATE 007: 상태 종료 시 제약조건 위반 */
export const DIN_STATE_007 = "DIN_STATE_007" as const;
/** STATE 008: KV 스토어에서 상태 로드 실패 */
export const DIN_STATE_008 = "DIN_STATE_008" as const;
/** STATE 009: MySQL에서 상태 로드 실패 */
export const DIN_STATE_009 = "DIN_STATE_009" as const;
/** STATE 010: 상태 불변식(Invariant) 깨짐 */
export const DIN_STATE_010 = "DIN_STATE_010" as const;

/** SHELL 101: 요청 타임아웃 초과 */
export const DIN_SHELL_101 = "DIN_SHELL_101" as const;
/** SHELL 102: 인증 실패 (Unauthorized) */
export const DIN_SHELL_102 = "DIN_SHELL_102" as const;
/** SHELL 103: 권한 없음 (Forbidden) */
export const DIN_SHELL_103 = "DIN_SHELL_103" as const;
/** SHELL 104: 요청 페이로드 형식 오류 */
export const DIN_SHELL_104 = "DIN_SHELL_104" as const;
/** SHELL 105: 리소스를 찾을 수 없음 */
export const DIN_SHELL_105 = "DIN_SHELL_105" as const;
/** SHELL 106: 데이터 정리(Prune) 작업 실패 */
export const DIN_SHELL_106 = "DIN_SHELL_106" as const;
/** SHELL 107: Cron 스케줄 작업 실패 */
export const DIN_SHELL_107 = "DIN_SHELL_107" as const;
/** SHELL 108: 응답 조립(Assembler) 실패 */
export const DIN_SHELL_108 = "DIN_SHELL_108" as const;
/** SHELL 109: 패치 적용 실패 */
export const DIN_SHELL_109 = "DIN_SHELL_109" as const;
/** SHELL 110: 세션 관리 오류 */
export const DIN_SHELL_110 = "DIN_SHELL_110" as const;

/** INFRA 201: KV 스토어 연동 오류 */
export const DIN_INFRA_201 = "DIN_INFRA_201" as const;
/** INFRA 202: MySQL 데이터베이스 오류 */
export const DIN_INFRA_202 = "DIN_INFRA_202" as const;
/** INFRA 203: Redis 캐시 오류 */
export const DIN_INFRA_203 = "DIN_INFRA_203" as const;
/** INFRA 204: 외부 Webhook 호출 오류 */
export const DIN_INFRA_204 = "DIN_INFRA_204" as const;
/** INFRA 205: 파일 시스템 I/O 오류 */
export const DIN_INFRA_205 = "DIN_INFRA_205" as const;
/** INFRA 206: SigImage 처리 오류 */
export const DIN_INFRA_206 = "DIN_INFRA_206" as const;
/** INFRA 207: 외부 Upstream API 호출 오류 */
export const DIN_INFRA_207 = "DIN_INFRA_207" as const;
/** INFRA 208: 인프라 계층 인증 오류 */
export const DIN_INFRA_208 = "DIN_INFRA_208" as const;
/** INFRA 209: 요청 Rate Limit 초과 */
export const DIN_INFRA_209 = "DIN_INFRA_209" as const;
/** INFRA 210: 메모리 부족 (Out of Memory) */
export const DIN_INFRA_210 = "DIN_INFRA_210" as const;

export const ERROR_CODES = {
  DIN_TIME_001: "DIN-TIME-001",
  DIN_TIME_002: "DIN-TIME-002",
  DIN_TIME_003: "DIN-TIME-003",

  DIN_POOL_001: "DIN-POOL-001",
  DIN_POOL_002: "DIN-POOL-002",
  DIN_POOL_003: "DIN-POOL-003",
  DIN_POOL_004: "DIN-POOL-004",
  DIN_POOL_005: "DIN-POOL-005",

  DIN_CB_001: "DIN-CB-001",
  DIN_CB_002: "DIN-CB-002",

  DIN_INVAR_001: "DIN-INVAR-001",
  DIN_INVAR_002: "DIN-INVAR-002",
  DIN_INVAR_003: "DIN-INVAR-003",
  DIN_INVAR_004: "DIN-INVAR-004",
  DIN_INVAR_005: "DIN-INVAR-005",
  DIN_INVAR_006: "DIN-INVAR-006",

  DIN_REENTRY_001: "DIN-REENTRY-001",
  DIN_REENTRY_002: "DIN-REENTRY-002",

  DIN_DEDUP_001: "DIN-DEDUP-001",
  DIN_DEDUP_002: "DIN-DEDUP-002",
  DIN_DEDUP_003: "DIN-DEDUP-003",
  DIN_DEDUP_004: "DIN-DEDUP-004",

  DIN_CONTRIB_001: "DIN-CONTRIB-001",
  DIN_CONTRIB_002: "DIN-CONTRIB-002",
  DIN_CONTRIB_003: "DIN-CONTRIB-003",

  DIN_STATE_001,
  DIN_STATE_002,
  DIN_STATE_003,
  DIN_STATE_004,
  DIN_STATE_005,
  DIN_STATE_006,
  DIN_STATE_007,
  DIN_STATE_008,
  DIN_STATE_009,
  DIN_STATE_010,

  DIN_SHELL_101,
  DIN_SHELL_102,
  DIN_SHELL_103,
  DIN_SHELL_104,
  DIN_SHELL_105,
  DIN_SHELL_106,
  DIN_SHELL_107,
  DIN_SHELL_108,
  DIN_SHELL_109,
  DIN_SHELL_110,

  DIN_INFRA_201,
  DIN_INFRA_202,
  DIN_INFRA_203,
  DIN_INFRA_204,
  DIN_INFRA_205,
  DIN_INFRA_206,
  DIN_INFRA_207,
  DIN_INFRA_208,
  DIN_INFRA_209,
  DIN_INFRA_210,
} as const;

export type DinErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
