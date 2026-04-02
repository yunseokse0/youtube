/**
 * 예전 단일 Redis 키(접미사 없음)에 남아 있던 데이터는
 * 지정된 계정 한 개로만 1회 마이그레이션합니다.
 * 신규 계정(demo1 등)은 빈 상태로 시작해야 하므로, 모든 userId에 레거시를 복사하면 안 됩니다.
 */
export function isLegacyMigrationTargetUserId(userId: string | null): boolean {
  if (!userId) return false;
  const allowed = (process.env.LEGACY_ACCOUNT_ID || "finalent").trim().toLowerCase();
  return userId.trim().toLowerCase() === allowed;
}
