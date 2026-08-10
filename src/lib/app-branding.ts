/** 브라우저 탭·로그인 등 제품 기본명(계정 미확인 시) */
export const APP_SYSTEM_NAME = "DIN Studio 엑셀 방송 시스템";

/** 계정·푸터 등 조직(브랜드)명 폴백 */
export const APP_BRAND_NAME = "DIN Studio";

export const APP_SYSTEM_DESCRIPTION = "DIN Studio 엑셀 방송 관리자 및 OBS/Prism 오버레이";

const SYSTEM_SUFFIX = "엑셀 방송 시스템";

/** 관리자 좌측 상단 — DIN Studio 고정 대신 로그인 계정명 */
export function adminHeaderTitle(account?: {
  id?: string | null;
  name?: string | null;
  companyName?: string | null;
} | null): string {
  const label = String(account?.name || account?.companyName || account?.id || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!label) return APP_SYSTEM_NAME;
  if (label.endsWith(SYSTEM_SUFFIX)) return label;
  return `${label} ${SYSTEM_SUFFIX}`;
}
