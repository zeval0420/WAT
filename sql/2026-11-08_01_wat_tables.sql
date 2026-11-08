-- WAT migration 01: weekly assessment tables.
-- Run against `dbadmin`. Safe to re-run (IF NOT EXISTS).
-- Uses the existing `accounts` table (employeeID) for teachers.

CREATE TABLE IF NOT EXISTS `schema_migrations` (
  `migration` varchar(100) NOT NULL,
  `applied_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`migration`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- A batch adviser (admin) approves the weekly list of one batch and can edit all its entries.
CREATE TABLE IF NOT EXISTS `wat_batch_advisers` (
  `batch` varchar(50) NOT NULL,
  `employeeID` varchar(20) NOT NULL,
  PRIMARY KEY (`batch`, `employeeID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `wat_subjects` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_subject_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `wat_assessments` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `batch` varchar(50) NOT NULL,
  `subject_id` int unsigned NOT NULL,
  `teacher_id` varchar(20) NOT NULL,
  `date_given` date NOT NULL,
  `deadline` date NOT NULL,
  `description` text NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_batch_deadline` (`batch`, `deadline`),
  KEY `idx_teacher` (`teacher_id`),
  CONSTRAINT `fk_wat_subject` FOREIGN KEY (`subject_id`) REFERENCES `wat_subjects` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One row per approved (batch, week). Students only see approved weeks.
CREATE TABLE IF NOT EXISTS `wat_week_approvals` (
  `batch` varchar(50) NOT NULL,
  `week_start` date NOT NULL,
  `approved_by` varchar(20) NOT NULL,
  `approved_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`batch`, `week_start`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO `schema_migrations` (`migration`) VALUES ('2026-11-08_01_wat_tables');
