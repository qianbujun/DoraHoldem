-- ========================================================
-- Dora Hold'em (宿命公牌) - MySQL 8.0+ Schema
-- ========================================================

CREATE DATABASE IF NOT EXISTS `dora_holdem` 
  DEFAULT CHARACTER SET utf8mb4 
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE `dora_holdem`;

-- 1. 用户表
CREATE TABLE IF NOT EXISTS `users` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(191) NOT NULL,
  `username` VARCHAR(64) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `preferred_lang` VARCHAR(10) NOT NULL DEFAULT 'zh-CN',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_email` (`email`),
  KEY `idx_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. 用户座位战绩表 (1~5号位)
CREATE TABLE IF NOT EXISTS `user_position_stats` (
  `user_id` BIGINT UNSIGNED NOT NULL,
  `seat_position` TINYINT UNSIGNED NOT NULL,
  `play_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `wins` INT UNSIGNED NOT NULL DEFAULT 0,
  `total_win_score` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `win_rate` DECIMAL(5,4) GENERATED ALWAYS AS (
    CASE WHEN `play_count` > 0 THEN ROUND(`wins` / `play_count`, 4) ELSE 0.0000 END
  ) STORED,
  `avg_win_score` DECIMAL(10,2) GENERATED ALWAYS AS (
    CASE WHEN `wins` > 0 THEN ROUND(`total_win_score` / `wins`, 2) ELSE 0.00 END
  ) STORED,
  PRIMARY KEY (`user_id`, `seat_position`),
  CONSTRAINT `fk_position_stats_user` FOREIGN KEY (`user_id`) 
    REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. 房间表
CREATE TABLE IF NOT EXISTS `rooms` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `room_code` VARCHAR(16) NOT NULL,
  `owner_id` BIGINT UNSIGNED NOT NULL,
  `status` ENUM('waiting', 'playing', 'finished') NOT NULL DEFAULT 'waiting',
  `password_hash` VARCHAR(255) DEFAULT NULL,
  `player_count` TINYINT UNSIGNED NOT NULL DEFAULT 4,
  `total_rounds` INT UNSIGNED NOT NULL,
  `current_round` INT UNSIGNED NOT NULL DEFAULT 0,
  `current_dealer_seat` TINYINT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_room_code` (`room_code`),
  KEY `idx_owner` (`owner_id`),
  CONSTRAINT `fk_rooms_owner` FOREIGN KEY (`owner_id`) 
    REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. 单小局牌谱主表
CREATE TABLE IF NOT EXISTS `hand_records` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `room_id` BIGINT UNSIGNED DEFAULT NULL,
  `round_number` INT UNSIGNED NOT NULL,
  `player_count` TINYINT UNSIGNED NOT NULL,
  `dealer_user_id` BIGINT UNSIGNED NOT NULL,
  `dora_rank` VARCHAR(4) NOT NULL,
  `initial_dora_card` VARCHAR(8) NOT NULL,
  `final_community_cards` JSON NOT NULL,
  `final_orbit` TINYINT UNSIGNED NOT NULL,
  `base_score` INT UNSIGNED NOT NULL,
  `total_pot` INT UNSIGNED NOT NULL DEFAULT 0,
  `end_reason` ENUM('voluntary_showdown', 'deck_depleted', 'lone_survivor') NOT NULL,
  `action_history` JSON NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_room_round` (`room_id`, `round_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. 玩家单局映射表
CREATE TABLE IF NOT EXISTS `user_hand_records` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `hand_id` BIGINT UNSIGNED NOT NULL,
  `seat_position` TINYINT UNSIGNED NOT NULL,
  `is_dealer` TINYINT(1) NOT NULL DEFAULT 0,
  `initial_hole_cards` JSON NOT NULL,
  `exposed_cards` JSON NOT NULL,
  `final_best_hand` JSON DEFAULT NULL,
  `hand_category` VARCHAR(32) DEFAULT NULL,
  `dora_count` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `is_folded` TINYINT(1) NOT NULL DEFAULT 0,
  `fold_orbit` TINYINT UNSIGNED DEFAULT NULL,
  `is_winner` TINYINT(1) NOT NULL DEFAULT 0,
  `net_score` INT NOT NULL,
  `is_favorite` TINYINT(1) NOT NULL DEFAULT 0,
  `favorite_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_hand` (`user_id`, `hand_id`),
  KEY `idx_user_recent_unfav` (`user_id`, `is_favorite`, `created_at` DESC),
  KEY `idx_user_favorites` (`user_id`, `is_favorite`, `favorite_at` DESC),
  KEY `idx_hand_id` (`hand_id`),
  CONSTRAINT `fk_uhr_user` FOREIGN KEY (`user_id`) 
    REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_uhr_hand` FOREIGN KEY (`hand_id`) 
    REFERENCES `hand_records` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER //

-- 1. 触发器: 50条收藏上限强约束
DROP TRIGGER IF EXISTS `trg_uhr_favorite_limit_check` //
CREATE TRIGGER `trg_uhr_favorite_limit_check`
BEFORE UPDATE ON `user_hand_records`
FOR EACH ROW
BEGIN
  -- DECLARE 必须在 BEGIN 的最开头
  DECLARE fav_count INT DEFAULT 0;

  IF NEW.`is_favorite` = 1 AND (OLD.`is_favorite` = 0 OR OLD.`is_favorite` IS NULL) THEN
    SELECT COUNT(*) INTO fav_count 
    FROM `user_hand_records` 
    WHERE `user_id` = NEW.`user_id` AND `is_favorite` = 1;
    
    IF fav_count >= 50 THEN
      SIGNAL SQLSTATE '45000' 
        SET MESSAGE_TEXT = 'FAVORITE_LIMIT_EXCEEDED: Maximum 50 favorites per user.';
    END IF;
    SET NEW.`favorite_at` = CURRENT_TIMESTAMP;
  ELSEIF NEW.`is_favorite` = 0 AND OLD.`is_favorite` = 1 THEN
    SET NEW.`favorite_at` = NULL;
  END IF;
END //

-- 2. 存储过程: 50条最近记录保留与孤立记录回收
DROP PROCEDURE IF EXISTS `sp_prune_user_hand_history` //
CREATE PROCEDURE `sp_prune_user_hand_history`(IN p_user_id BIGINT UNSIGNED)
BEGIN
  -- 清理当前用户超出 50 条的未收藏记录
  DELETE FROM `user_hand_records`
  WHERE `user_id` = p_user_id
    AND `is_favorite` = 0
    AND `id` NOT IN (
      SELECT `keep_id` FROM (
        SELECT `id` AS `keep_id`
        FROM `user_hand_records`
        WHERE `user_id` = p_user_id AND `is_favorite` = 0
        ORDER BY `created_at` DESC, `id` DESC
        LIMIT 50
      ) AS `temp_keep`
    );

  -- 清理失去关联的孤立牌局
  DELETE `hr` FROM `hand_records` `hr`
  LEFT JOIN `user_hand_records` `uhr` ON `hr`.`id` = `uhr`.`hand_id`
  WHERE `uhr`.`id` IS NULL;
END //

DELIMITER ;