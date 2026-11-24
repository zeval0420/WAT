CREATE TABLE IF NOT EXISTS wat_assessment_colors (
    assessment_type VARCHAR(32) NOT NULL PRIMARY KEY,
    color CHAR(7) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO schema_migrations (migration) VALUES ('2026-11-24_04_assessment_colors');
