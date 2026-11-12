-- Журнал посещений (React_Suz / React_Suz_dev)
-- Таблицы создаются автоматически при первом обращении к /api/visits,
-- этот файл нужен для ручной подготовки боевой базы на hund03.

CREATE TABLE IF NOT EXISTS `site_visits` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `session_id` VARCHAR(64) NOT NULL,
  `login` VARCHAR(255) NULL,
  `role` VARCHAR(40) NULL,
  `ip` VARCHAR(64) NULL,
  `user_agent` VARCHAR(512) NULL,
  `os` VARCHAR(40) NULL,
  `browser` VARCHAR(40) NULL,
  `device` VARCHAR(20) NULL,
  `source` VARCHAR(120) NULL,
  `source_kind` VARCHAR(20) NULL,
  `referrer` VARCHAR(1024) NULL,
  `utm_source` VARCHAR(120) NULL,
  `utm_medium` VARCHAR(120) NULL,
  `utm_campaign` VARCHAR(160) NULL,
  `landing_path` VARCHAR(512) NULL,
  `last_path` VARCHAR(512) NULL,
  `page_views` INT UNSIGNED NOT NULL DEFAULT 0,
  `active_seconds` INT UNSIGNED NOT NULL DEFAULT 0,
  `language` VARCHAR(24) NULL,
  `timezone` VARCHAR(80) NULL,
  `screen` VARCHAR(24) NULL,
  `started_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_seen_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_site_visits_session` (`session_id`),
  KEY `idx_site_visits_started` (`started_at`),
  KEY `idx_site_visits_last_seen` (`last_seen_at`),
  KEY `idx_site_visits_login` (`login`),
  KEY `idx_site_visits_source` (`source`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `site_visit_pages` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `visit_id` BIGINT UNSIGNED NOT NULL,
  `path` VARCHAR(512) NOT NULL,
  `title` VARCHAR(255) NULL,
  `views` INT UNSIGNED NOT NULL DEFAULT 1,
  `first_seen_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_seen_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_site_visit_page` (`visit_id`, `path`),
  KEY `idx_site_visit_pages_path` (`path`),
  KEY `idx_site_visit_pages_last_seen` (`last_seen_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
