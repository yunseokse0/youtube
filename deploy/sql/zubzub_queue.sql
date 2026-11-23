-- 대표 시그 줍줍(복제형·무제한 타이머) 대기열 및 이력 테이블
-- EC2: mysql youtube < deploy/sql/zubzub_queue.sql
-- 서버 기동 또는 API 실행 시 ensureZubzubQueueTable(c)로 자동 생성됨

CREATE TABLE IF NOT EXISTS zubzub_queue (
  id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  trigger_donation_id VARCHAR(128) NOT NULL,
  sig_name VARCHAR(128) NOT NULL,
  sig_image_url VARCHAR(512) NULL,
  bonus_amount INT NOT NULL,
  status ENUM('WAITING', 'CLAIMED', 'CANCELED') NOT NULL DEFAULT 'WAITING',
  claimed_by_member_id VARCHAR(128) NULL,
  claimed_donation_id VARCHAR(128) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  claimed_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  KEY idx_user_status_created (user_id, status, created_at),
  KEY idx_trigger_donation (trigger_donation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
