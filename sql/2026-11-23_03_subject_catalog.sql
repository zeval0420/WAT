-- Keep existing subject_id values linked to their original WAT names.
-- New selections reference the school's subject table directly.
SET @catalog_migration = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wat_assessments'
      AND COLUMN_NAME = 'catalog_subject_id'
  ),
  'SELECT 1',
  'ALTER TABLE wat_assessments
    MODIFY subject_id INT UNSIGNED NULL,
    ADD catalog_subject_id INT NULL,
    ADD CONSTRAINT fk_wat_catalog_subject FOREIGN KEY (catalog_subject_id) REFERENCES subject (id)'
);
PREPARE catalog_migration FROM @catalog_migration;
EXECUTE catalog_migration;
DEALLOCATE PREPARE catalog_migration;

INSERT IGNORE INTO schema_migrations (migration) VALUES ('2026-11-23_03_subject_catalog');
