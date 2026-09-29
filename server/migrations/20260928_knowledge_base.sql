-- База знаний: таблица статей (раздел /knowledge-base).
-- Таблица существовала только в старой базе и создавалась вручную: в репозитории
-- не было ни DDL, ни миграции, поэтому добавление статьи падало с 500
-- ("Table 'its.knowledge_base' doesn't exist").
-- MySQL / MariaDB. Запуск вручную в Ubuntu:
--   mysql -u admin -p its < server/migrations/20260928_knowledge_base.sql
-- Серверный код (server/routes/knowledgeBase.js) создаёт таблицу и сам,
-- поэтому миграция нужна только там, где у пользователя БД нет прав на CREATE.

CREATE TABLE IF NOT EXISTS knowledge_base (
  id INT NOT NULL AUTO_INCREMENT,
  title VARCHAR(255) NOT NULL,
  solution LONGTEXT NOT NULL,
  category VARCHAR(120) NOT NULL DEFAULT 'Общее',
  images LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_knowledge_base_category (category),
  KEY idx_knowledge_base_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
