-- JyoCanCook MySQL Database Schema
-- Compatible with MySQL 8.0+ / MariaDB 10.4+ (Hostinger Native)
-- Character Set: utf8mb4 / Collation: utf8mb4_unicode_ci

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- 1. Admins Table
CREATE TABLE IF NOT EXISTS `admins` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `username` VARCHAR(60) NOT NULL UNIQUE,
  `email` VARCHAR(190) NOT NULL UNIQUE,
  `password_hash` VARCHAR(255) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Categories Table
CREATE TABLE IF NOT EXISTS `categories` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `slug` VARCHAR(80) NOT NULL UNIQUE,
  `name` VARCHAR(80) NOT NULL,
  `description` VARCHAR(300) NOT NULL DEFAULT '',
  `image` VARCHAR(300) NOT NULL DEFAULT '',
  `order_num` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_category_order` (`order_num`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2b. Sub Categories Table (independent of categories; a recipe stores the slugs)
CREATE TABLE IF NOT EXISTS `subcategories` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `slug` VARCHAR(80) NOT NULL UNIQUE,
  `name` VARCHAR(80) NOT NULL,
  `order_num` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2c. Which sub categories each category offers (a category can have several)
CREATE TABLE IF NOT EXISTS `category_subcategories` (
  `category_slug` VARCHAR(80) NOT NULL,
  `subcategory_slug` VARCHAR(80) NOT NULL,
  PRIMARY KEY (`category_slug`, `subcategory_slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2d. Diets (Vegetarian, Non-Vegetarian, Vegan...). A recipe stores its diet names, comma-separated, in recipes.diet.
CREATE TABLE IF NOT EXISTS `diets` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `slug` VARCHAR(40) NOT NULL UNIQUE,
  `name` VARCHAR(40) NOT NULL UNIQUE,
  `order_num` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Tags Table
CREATE TABLE IF NOT EXISTS `tags` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(60) NOT NULL UNIQUE,
  `slug` VARCHAR(80) NOT NULL UNIQUE,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Menu Items Table
CREATE TABLE IF NOT EXISTS `menu_items` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `label` VARCHAR(70) NOT NULL,
  `href` VARCHAR(255) NOT NULL,
  `order_num` INT NOT NULL DEFAULT 0,
  `visible` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_menu_order` (`order_num`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Recipes Table
CREATE TABLE IF NOT EXISTS `recipes` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `slug` VARCHAR(100) NOT NULL UNIQUE,
  `title` VARCHAR(140) NOT NULL,
  `description` VARCHAR(1000) NOT NULL DEFAULT '',
  `category_slug` VARCHAR(80) NOT NULL,
  `subcategory_slug` VARCHAR(80) NULL,
  `diet` VARCHAR(120) NOT NULL DEFAULT 'Vegetarian',
  `prep_time` INT UNSIGNED NOT NULL DEFAULT 15,
  `cook_time` INT UNSIGNED NOT NULL DEFAULT 30,
  `servings` INT UNSIGNED NOT NULL DEFAULT 4,
  `difficulty` VARCHAR(40) NOT NULL DEFAULT 'Easy',
  `image` VARCHAR(300) NOT NULL DEFAULT '/images/recipes/recipe-placeholder.svg',
  `published` TINYINT(1) NOT NULL DEFAULT 1,
  `featured` TINYINT(1) NOT NULL DEFAULT 0,
  `story` TEXT NULL,
  `youtube_url` VARCHAR(300) NULL,
  `cuisine` VARCHAR(60) NULL,
  `calories` INT UNSIGNED NULL,
  `carbs` DECIMAL(6,1) NULL,
  `protein` DECIMAL(6,1) NULL,
  `fat` DECIMAL(6,1) NULL,
  `fiber` DECIMAL(6,1) NULL,
  `tips_json` JSON NULL,
  `serve_with_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `published_at` DATETIME NULL,
  INDEX `idx_recipe_category` (`category_slug`),
  INDEX `idx_recipe_published` (`published`),
  INDEX `idx_recipe_featured` (`featured`),
  INDEX `idx_recipe_diet` (`diet`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Recipe Ingredients Table
CREATE TABLE IF NOT EXISTS `recipe_ingredients` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `recipe_id` INT UNSIGNED NOT NULL,
  `section` VARCHAR(100) NULL,
  `name` VARCHAR(180) NOT NULL,
  `amount` DECIMAL(8,2) NULL,
  `unit` VARCHAR(25) NOT NULL DEFAULT '',
  `order_num` INT UNSIGNED NOT NULL DEFAULT 0,
  FOREIGN KEY (`recipe_id`) REFERENCES `recipes` (`id`) ON DELETE CASCADE,
  INDEX `idx_ing_recipe_order` (`recipe_id`, `order_num`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. Recipe Steps Table
CREATE TABLE IF NOT EXISTS `recipe_steps` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `recipe_id` INT UNSIGNED NOT NULL,
  `title` VARCHAR(180) NOT NULL DEFAULT 'Step',
  `text` TEXT NOT NULL,
  `image` VARCHAR(300) NULL,
  `order_num` INT UNSIGNED NOT NULL DEFAULT 0,
  FOREIGN KEY (`recipe_id`) REFERENCES `recipes` (`id`) ON DELETE CASCADE,
  INDEX `idx_step_recipe_order` (`recipe_id`, `order_num`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. Recipe Tags (Many-to-Many Pivot Table)
CREATE TABLE IF NOT EXISTS `recipe_tags` (
  `recipe_id` INT UNSIGNED NOT NULL,
  `tag_id` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`recipe_id`, `tag_id`),
  FOREIGN KEY (`recipe_id`) REFERENCES `recipes` (`id`) ON DELETE CASCADE,
  FOREIGN KEY (`tag_id`) REFERENCES `tags` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. Publish Logs Table
CREATE TABLE IF NOT EXISTS `publish_logs` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `status` ENUM('pending', 'in_progress', 'success', 'failed') NOT NULL DEFAULT 'pending',
  `triggered_by` VARCHAR(100) NOT NULL DEFAULT 'admin',
  `message` VARCHAR(255) NOT NULL DEFAULT '',
  `details_json` JSON NULL,
  `started_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` DATETIME NULL,
  INDEX `idx_publish_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. Rate Limiting Table (for brute-force protection)
CREATE TABLE IF NOT EXISTS `login_attempts` (
  `ip_address` VARCHAR(45) NOT NULL,
  `attempted_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_ip_time` (`ip_address`, `attempted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
