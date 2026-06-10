-- Workflow заявки: связь чата сотрудника и панели администратора.
-- MySQL / MariaDB. Запуск вручную в Ubuntu:
--   mysql -u admin -p its < server/migrations/20260608_application_workflow.sql

ALTER TABLE application ADD COLUMN IF NOT EXISTS status VARCHAR(40) NULL DEFAULT 'new';
ALTER TABLE application MODIFY COLUMN `status` VARCHAR(40) NULL DEFAULT 'new';
ALTER TABLE application ADD COLUMN IF NOT EXISTS `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE application ADD COLUMN IF NOT EXISTS `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
ALTER TABLE application ADD COLUMN IF NOT EXISTS employee_login VARCHAR(255) NULL;
ALTER TABLE application ADD COLUMN IF NOT EXISTS category VARCHAR(80) NULL;
ALTER TABLE application ADD COLUMN IF NOT EXISTS priority VARCHAR(40) NULL;
ALTER TABLE application ADD COLUMN IF NOT EXISTS accepted_by VARCHAR(255) NULL;
ALTER TABLE application ADD COLUMN IF NOT EXISTS accepted_at DATETIME NULL;
ALTER TABLE application ADD COLUMN IF NOT EXISTS work_started_at DATETIME NULL;
ALTER TABLE application ADD COLUMN IF NOT EXISTS resolved_at DATETIME NULL;
ALTER TABLE application ADD COLUMN IF NOT EXISTS employee_confirmed_at DATETIME NULL;
ALTER TABLE application ADD COLUMN IF NOT EXISTS admin_comment TEXT NULL;
ALTER TABLE application ADD COLUMN IF NOT EXISTS eta_minutes INT NULL;
ALTER TABLE application ADD COLUMN IF NOT EXISTS waiting_seconds INT NULL;
ALTER TABLE application ADD COLUMN IF NOT EXISTS arrival_seconds INT NULL;
ALTER TABLE application ADD COLUMN IF NOT EXISTS work_seconds INT NULL;
ALTER TABLE application ADD COLUMN IF NOT EXISTS source VARCHAR(40) NOT NULL DEFAULT 'admin';
ALTER TABLE application ADD COLUMN IF NOT EXISTS chat_thread_id VARCHAR(255) NULL;
ALTER TABLE application ADD COLUMN IF NOT EXISTS source_message_id VARCHAR(255) NULL;
ALTER TABLE application ADD COLUMN IF NOT EXISTS employee_comment TEXT NULL;

UPDATE application
SET `status` = CASE
  WHEN `fl` = 1 OR `status` = 'выполнено' THEN 'done'
  WHEN `status` = 'отменено' THEN 'reopened'
  WHEN `status` = 'в работе' THEN 'new'
  ELSE `status`
END
WHERE `status` IS NULL OR `status` = '' OR `status` IN ('в работе', 'выполнено', 'отменено');

CREATE TABLE IF NOT EXISTS application_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  application_id INT NOT NULL,
  actor_login VARCHAR(255) NULL,
  actor_role VARCHAR(40) NULL,
  event_type VARCHAR(80) NOT NULL,
  comment TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_application_events_application_id (application_id)
);
