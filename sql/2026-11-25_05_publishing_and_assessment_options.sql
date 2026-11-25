-- Run on the WAT database after migrations 01–04. Safe to run again.
-- Existing explicit publications and batch adviser assignments are retained.
ALTER TABLE wat_assessments
    ADD COLUMN IF NOT EXISTS stakes VARCHAR(8) NULL,
    ADD COLUMN IF NOT EXISTS audience VARCHAR(8) NOT NULL DEFAULT 'all',
    ADD COLUMN IF NOT EXISTS include_other_grade TINYINT(1) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS wat_schedule_lock (
    id TINYINT UNSIGNED NOT NULL PRIMARY KEY
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO wat_schedule_lock (id) VALUES (1);

CREATE TABLE IF NOT EXISTS wat_batch_limits (
    batch VARCHAR(50) NOT NULL PRIMARY KEY,
    high_limit SMALLINT UNSIGNED NOT NULL,
    low_limit SMALLINT UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS wat_assessment_changes (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    assessment_id INT UNSIGNED NULL,
    requested_by VARCHAR(20) NOT NULL,
    before_entry JSON NULL,
    after_entry JSON NULL,
    status VARCHAR(12) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP NULL,
    KEY idx_assessment_status (assessment_id, status),
    KEY idx_change_requester (requested_by, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS wat_assessment_change_reviews (
    change_id INT UNSIGNED NOT NULL,
    batch VARCHAR(50) NOT NULL,
    week_start DATE NOT NULL,
    decision VARCHAR(12) NOT NULL DEFAULT 'pending',
    reviewed_by VARCHAR(20) NULL,
    reviewed_at TIMESTAMP NULL,
    PRIMARY KEY (change_id, batch, week_start),
    KEY idx_batch_week_decision (batch, week_start, decision),
    CONSTRAINT fk_wat_review_change FOREIGN KEY (change_id) REFERENCES wat_assessment_changes (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS wat_email_templates (
    kind VARCHAR(20) NOT NULL PRIMARY KEY,
    subject VARCHAR(160) NOT NULL,
    body TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS wat_email_queue (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    recipient VARCHAR(254) NOT NULL,
    kind VARCHAR(20) NOT NULL,
    batch VARCHAR(50) NOT NULL,
    week_start DATE NOT NULL,
    subject VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    available_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    claimed_at DATETIME NULL,
    claim_token CHAR(32) NULL,
    sent_at DATETIME NULL,
    attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    KEY idx_wat_email_ready (sent_at, available_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO schema_migrations (migration) VALUES ('2026-11-25_05_publishing_and_assessment_options');
