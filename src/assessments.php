<?php
function assessmentGrade($batch)
{
    return is_string($batch) && preg_match('/^Grade (7|8|9|10|11|12)$/D', $batch, $match) ? $match[1] : null;
}

function assessmentGroups($db, $adviserRows)
{
    $grades = rows($db, 'SELECT DISTINCT grade FROM section WHERE grade IN (7,8,9,10,11,12) ORDER BY grade+0');
    $groups = array_map(static function ($row) { return 'Grade ' . (int) $row['grade']; }, $grades);
    return array_values(array_unique(array_merge($groups, array_column($adviserRows, 'batch'))));
}

function validDate($value)
{
    if (!is_string($value) || !preg_match('/^\d{4}-\d{2}-\d{2}$/D', $value)) {
        return false;
    }
    [$year, $month, $day] = array_map('intval', explode('-', $value));
    return checkdate($month, $day, $year);
}

function isWeekend($date)
{
    return (int) (new DateTimeImmutable($date))->format('N') >= 6;
}

function canManageBatch($user, $batch)
{
    return $user['isAdmin'] || in_array($batch, $user['adviserOf'], true);
}

function weekData($db, $user, $batch, $date)
{
    if (!is_string($batch) || $batch === '') {
        reply(['error' => 'Batch required.'], 400);
    }
    $timezone = new DateTimeZone('Asia/Manila');
    $currentMonday = (new DateTimeImmutable('today', $timezone))->modify('monday this week');
    $day = validDate($date) ? new DateTimeImmutable($date, $timezone) : $currentMonday;
    $monday = $day->modify('monday this week');
    $start = $monday->format('Y-m-d');
    $end = $monday->modify('+6 days')->format('Y-m-d');
    $approved = (bool) rows($db, 'SELECT 1 FROM wat_week_approvals WHERE batch=? AND week_start=?', [$batch, $start]);
    $requiresApproval = $monday > $currentMonday;
    $visibleToStudents = !$requiresApproval || $approved;
    $week = compact('start', 'end', 'approved', 'requiresApproval', 'visibleToStudents');
    if ($user === null && !$visibleToStudents) {
        return $week + ['items' => []];
    }

    $params = [$batch, $start, $end];
    $sql = 'SELECT a.*, legacy.name AS subject FROM wat_assessments a
            LEFT JOIN wat_subjects legacy ON legacy.id=a.subject_id
            WHERE a.batch=? AND a.deadline BETWEEN ? AND ?';
    $isAdviser = $user !== null && canManageBatch($user, $batch);
    if ($user !== null && !$isAdviser) {
        $sql .= ' AND a.teacher_id=?';
        $params[] = $user['id'];
    }
    $items = rows($db, $sql . ' ORDER BY a.deadline, legacy.name', $params);

    // Preserve entries saved by deployments that ran the earlier catalog migration.
    $catalogIds = array_values(array_unique(array_filter(array_column($items, 'catalog_subject_id'))));
    if ($catalogIds) {
        $slots = implode(',', array_fill(0, count($catalogIds), '?'));
        $codes = array_column(rows($db, "SELECT id, subjectCode FROM subject WHERE id IN ($slots)", $catalogIds), 'subjectCode', 'id');
        foreach ($items as &$item) {
            if (isset($item['catalog_subject_id'])) {
                $item['subject'] = $codes[$item['catalog_subject_id']] ?? $item['subject'];
            }
        }
        unset($item);
        usort($items, static function ($a, $b) {
            return strcmp($a['deadline'], $b['deadline']) ?: strcasecmp($a['subject'] ?? '', $b['subject'] ?? '');
        });
    }
    if ($user === null) {
        $publicFields = array_flip(['id', 'subject', 'date_given', 'deadline', 'description']);
        $items = array_map(static function ($item) use ($publicFields) { return array_intersect_key($item, $publicFields); }, $items);
        return $week + compact('items');
    }

    // accounts and the WAT tables use different collations. Look names up separately.
    $names = [WAT_BUILT_IN_ADMIN => WAT_BUILT_IN_ADMIN];
    $ids = array_diff(array_unique(array_column($items, 'teacher_id')), array_keys($names));
    if ($ids) {
        $slots = implode(',', array_fill(0, count($ids), '?'));
        $names += array_column(rows($db, "SELECT employeeID, CONCAT(firstname, ' ', lastname) AS name
            FROM accounts WHERE employeeID IN ($slots)", $ids), 'name', 'employeeID');
    }
    foreach ($items as &$item) {
        $id = $item['teacher_id'];
        $item['teacher'] = $names[$id] ?? ($id === 'admin.controller' ? $id : '');
    }
    unset($item);
    return $week + compact('items', 'isAdviser');
}

function saveAssessment($db, $user, $method, $input, $id)
{
    $old = null;
    if ($method !== 'POST') {
        $old = rows($db, 'SELECT * FROM wat_assessments WHERE id=?', [$id])[0] ?? null;
        if (!$old || (isset($input['batch']) && $input['batch'] !== $old['batch'])) {
            reply(['error' => 'Assessment not found.'], 404);
        }
        if ($old['teacher_id'] !== $user['id'] && !canManageBatch($user, $old['batch'])) {
            reply(['error' => 'You can only edit your own entries.'], 403);
        }
        if ($method === 'DELETE') {
            statement($db, 'DELETE FROM wat_assessments WHERE id=?', [$id]);
            return ['ok' => true];
        }
        if ($method === 'PATCH') {
            $due = $input['deadline'] ?? null;
            if (!validDate($due)) {
                reply(['error' => 'Choose a valid deadline.'], 400);
            }
            if (isWeekend($due)) {
                reply(['error' => 'Choose a deadline from Monday to Friday.'], 400);
            }
            if ($due < $old['date_given']) {
                reply(['error' => 'The deadline must be on or after the date given.'], 400);
            }
            if ($due !== $old['deadline']) {
                $stmt = statement($db, 'UPDATE wat_assessments SET deadline=? WHERE id=? AND date_given<=? AND deadline=?',
                    [$due, $id, $due, $old['deadline']]);
                if (!$stmt->affected_rows) {
                    reply(['error' => 'This assessment changed. Refresh the calendar and try again.'], 409);
                }
            }
            return ['ok' => true];
        }
    }

    $entry = $input + ($old ?? []);
    $batch = $old['batch'] ?? ($entry['batch'] ?? '');
    $grade = assessmentGrade($batch);
    $subjectId = $old['subject_id'] ?? null;
    $catalogSubject = $old['catalog_subject_id'] ?? null;
    $subjectCode = $input['subject_code'] ?? null;
    if (($subjectCode !== null && (!is_string($subjectCode) || $subjectCode === '')) ||
        ($subjectCode === null && !$subjectId && !$catalogSubject)) {
        reply(['error' => 'Select a subject from the school catalog.'], 400);
    }
    $given = $entry['date_given'] ?? null;
    $due = $entry['deadline'] ?? null;
    $description = trim($entry['description'] ?? '');
    $type = $entry['assessment_type'] ?? '';
    $mode = $entry['implementation'] ?? '';
    $topic = trim($entry['topic'] ?? '');
    $remarks = trim($entry['remarks'] ?? '');
    if (validDate($given) && $given !== ($old['date_given'] ?? null) && isWeekend($given)) {
        reply(['error' => 'Choose a date given from Monday to Friday.'], 400);
    }
    if (validDate($due) && isWeekend($due)) {
        reply(['error' => 'Choose a deadline from Monday to Friday.'], 400);
    }
    if (!$batch || !validDate($given) || !validDate($due) ||
        $due < $given || $description === '' || preg_match('/.{256}/su', $topic) || preg_match('/.{4001}/su', $remarks) ||
        !in_array($type, ['', 'formative', 'summative', 'alternative'], true) ||
        !in_array($mode, ['', 'sync', 'async'], true)) {
        reply(['error' => 'Invalid entry. Check fields and deadline.'], 400);
    }
    if (!$old) {
        $groups = assessmentGroups($db, rows($db, 'SELECT DISTINCT batch FROM wat_batch_advisers'));
        if (!in_array($batch, $groups, true)) {
            reply(['error' => 'Unknown grade level or batch.'], 400);
        }
    }
    if ($subjectCode !== null) {
        $sql = "SELECT subjectCode FROM subject WHERE subjectCode=? AND status='active'";
        $params = [$subjectCode];
        if ($grade !== null) {
            $sql .= ' AND subjectGradeLevel+0=?';
            $params[] = $grade;
        }
        $course = rows($db, $sql . ' ORDER BY id LIMIT 1', $params)[0] ?? null;
        if (!$course) {
            reply(['error' => 'Select an active subject for this grade level.'], 400);
        }
        $stmt = statement($db, 'INSERT INTO wat_subjects (name) VALUES (?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)',
            [$course['subjectCode']]);
        $subjectId = $stmt->insert_id;
    }

    $values = [$subjectId, $given, $due, $description, $type ?: null, $topic === '' ? null : $topic,
        $mode ?: null, $remarks === '' ? null : $remarks];
    if ($old) {
        $catalogUpdate = $catalogSubject && $subjectCode !== null ? ', catalog_subject_id=NULL' : '';
        $values[] = $id;
        statement($db, 'UPDATE wat_assessments SET subject_id=?, date_given=?, deadline=?, description=?,
            assessment_type=?, topic=?, implementation=?, remarks=?' . $catalogUpdate . ' WHERE id=?', $values);
        return ['ok' => true];
    }
    $values[] = $batch;
    $values[] = $user['id'];
    $stmt = statement($db, 'INSERT INTO wat_assessments (subject_id,date_given,deadline,description,
        assessment_type,topic,implementation,remarks,batch,teacher_id) VALUES (?,?,?,?,?,?,?,?,?,?)', $values);
    return ['id' => $stmt->insert_id];
}
