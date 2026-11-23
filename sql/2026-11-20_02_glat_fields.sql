SET @glat_migration = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wat_assessments'
      AND COLUMN_NAME = 'assessment_type'
  ),
  'SELECT 1',
  'ALTER TABLE wat_assessments
    ADD assessment_type VARCHAR(32) NULL,
    ADD topic VARCHAR(255) NULL,
    ADD implementation VARCHAR(16) NULL,
    ADD remarks TEXT NULL'
);
PREPARE glat_migration FROM @glat_migration;
EXECUTE glat_migration;
DEALLOCATE PREPARE glat_migration;

INSERT IGNORE INTO schema_migrations (migration) VALUES ('2026-11-20_02_glat_fields');
