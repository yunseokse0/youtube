-- Phase 1: AppState donors dual-write mirror
-- EC2: mysql youtube < deploy/sql/broadcast_donations.sql
-- 또는 앱 기동/첫 sync 시 CREATE TABLE IF NOT EXISTS 자동 적용

CREATE TABLE IF NOT EXISTS broadcast_donations (
  user_id VARCHAR(64) NOT NULL,
  id VARCHAR(128) NOT NULL,
  name VARCHAR(191) NOT NULL,
  amount INT NOT NULL,
  member_id VARCHAR(128) NOT NULL,
  at_ms BIGINT NOT NULL,
  target VARCHAR(16) NULL,
  message TEXT NULL,
  member_auto_assigned TINYINT(1) NOT NULL DEFAULT 0,
  group_split TINYINT(1) NOT NULL DEFAULT 0,
  group_split_source TINYINT(1) NOT NULL DEFAULT 0,
  donation_excluded TINYINT(1) NOT NULL DEFAULT 0,
  hs_territory_excluded TINYINT(1) NOT NULL DEFAULT 0,
  hs_push_dir VARCHAR(16) NULL,
  contribution_points INT NULL,
  updated_at_ms BIGINT NOT NULL,
  PRIMARY KEY (user_id, id),
  KEY idx_user_at (user_id, at_ms),
  KEY idx_user_member (user_id, member_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
