<?php
function assessmentGrade($batch)
{
    return is_string($batch) && preg_match('/^Grade (7|8|9|10|11|12)$/D', $batch, $match) ? $match[1] : null;
}

function assessmentGroups($db, $adviserRows)
{
    $grades = rows($db, 'SELECT DISTINCT grade FROM section WHERE grade IN (7,8,9,10,11,12) ORDER BY grade+0');
    $groups = array_map(static function ($row) { return 'Grade ' . (int) $row['grade']; }, $grades);
    return array_values(array_unique(array_merge(
        $groups,
        array_column($adviserRows, 'batch'),
        array_column(rows($db, 'SELECT DISTINCT batch FROM wat_assessments ORDER BY batch'), 'batch'),
        array_column(rows($db, 'SELECT DISTINCT batch FROM wat_week_approvals ORDER BY batch'), 'batch'),
        array_column(rows($db, "SELECT DISTINCT r.batch FROM wat_assessment_change_reviews r
            JOIN wat_assessment_changes c ON c.id=r.change_id WHERE c.status='pending' ORDER BY r.batch"), 'batch')
    )));
}

function validDate($value)
{
    if (!is_string($value) || !preg_match('/^\d{4}-\d{2}-\d{2}$/D', $value)) {
        return false;
    }
    [$year, $month, $day] = array_map('intval', explode('-', $value));
    return $year >= 1000 && checkdate($month, $day, $year);
}

function isWeekend($date)
{
    return (int) (new DateTimeImmutable($date))->format('N') >= 6;
}

function weekStart($date)
{
    return (new DateTimeImmutable($date))->modify('monday this week')->format('Y-m-d');
}

function canManageBatch($user, $batch)
{
    return $user['isAdmin'] || in_array($batch, $user['adviserOf'] ?? [], true);
}

function otherSeniorGrade($batch)
{
    return ['Grade 11' => 'Grade 12', 'Grade 12' => 'Grade 11'][$batch] ?? null;
}

function assessmentStakes($type)
{
    return $type === 'formative' ? 'low' : 'high';
}

const ASSESSMENT_SELECT = 'SELECT a.*, COALESCE(
        CONVERT(catalog.subjectCode USING utf8mb4) COLLATE utf8mb4_unicode_ci,
        CONVERT(legacy.name USING utf8mb4) COLLATE utf8mb4_unicode_ci) AS subject
    FROM wat_assessments a
    LEFT JOIN wat_subjects legacy ON legacy.id=a.subject_id
    LEFT JOIN subject catalog ON catalog.id=a.catalog_subject_id';

function assessmentRow($db, $id)
{
    return rows($db, ASSESSMENT_SELECT . ' WHERE a.id=?', [$id])[0] ?? null;
}

function formatAssessments($db, $items, $user, $batch = null, $pending = [])
{
    $names = [WAT_BUILT_IN_ADMIN => WAT_BUILT_IN_ADMIN, 'admin.controller' => 'admin.controller'];
    if ($user !== null) {
        $ids = array_values(array_diff(array_unique(array_column($items, 'teacher_id')), array_keys($names)));
        if ($ids) {
            $slots = implode(',', array_fill(0, count($ids), '?'));
            $names = array_column(rows($db, "SELECT employeeID, CONCAT(firstname, ' ', lastname) AS name
                FROM accounts WHERE employeeID IN ($slots)", $ids), 'name', 'employeeID') + $names;
        }
    }
    foreach ($items as &$item) {
        $item['stakes'] = $item['stakes'] ?? assessmentStakes($item['assessment_type']);
        $item['include_other_grade'] = (bool) $item['include_other_grade'];
        $item['source_batch'] = $item['batch'];
        if ($batch !== null && $item['batch'] !== $batch) {
            $item['batch'] = $batch;
            if ($user === null) {
                $item['audience'] = 'elective';
            }
        }
        if ($user === null) {
            $publicFields = ['id', 'subject', 'date_given', 'deadline', 'topic', 'description',
                'assessment_type', 'implementation', 'stakes', 'audience'];
            $item = array_intersect_key($item, array_flip($publicFields));
        } else {
            $item['teacher'] = $names[$item['teacher_id']] ?? '';
            $owned = $item['teacher_id'] === $user['id'];
            $item['pending'] = $owned && isset($pending[(string) $item['id']]);
            $item['editable'] = $owned && !$item['pending'];
            if (!$owned) {
                unset($item['remarks']);
            }
        }
    }
    unset($item);
    return $items;
}

function weekData($db, $user, $batch, $date)
{
    if (!is_string($batch) || $batch === '') {
        reply(['error' => 'Batch required.'], 400);
    }
    $today = new DateTimeImmutable('today', new DateTimeZone('Asia/Manila'));
    $monday = validDate($date) ? new DateTimeImmutable(weekStart($date)) : $today->modify('monday this week');
    $start = $monday->format('Y-m-d');
    $end = $monday->modify('+6 days')->format('Y-m-d');
    $approved = (bool) rows($db, 'SELECT 1 FROM wat_week_approvals WHERE batch=? AND week_start=?', [$batch, $start]);
    $week = compact('start', 'end', 'approved') + ['requiresApproval' => !$approved, 'visibleToStudents' => $approved];
    if ($user === null && !$approved) {
        return $week + ['items' => []];
    }

    $params = [$start, $end, $batch];
    $scope = 'a.batch=?';
    $other = otherSeniorGrade($batch);
    if ($other !== null) {
        $scope .= " OR (a.batch=? AND a.include_other_grade=1 AND a.audience IN ('elective', 'all'))";
        $params[] = $other;
    }
    $where = "a.deadline BETWEEN ? AND ? AND ($scope)";
    if ($user === null) {
        $where .= ' AND EXISTS (SELECT 1 FROM wat_week_approvals WHERE batch=? AND week_start=?)';
        array_push($params, $batch, $start);
    }
    $items = rows($db, ASSESSMENT_SELECT . " WHERE $where ORDER BY a.deadline, subject, a.id", $params);
    if ($user === null) {
        return $week + ['items' => formatAssessments($db, $items, null, $batch)];
    }
    $pending = array_fill_keys(array_column(ownPendingAssessmentChanges($db, $user), 'assessment_id'), true);
    return $week + ['items' => formatAssessments($db, $items, $user, $batch, $pending),
        'isAdviser' => canManageBatch($user, $batch), 'limits' => batchLimits($db, $batch)];
}

function teacherSummary($db, $user)
{
    return watTransaction($db, function () use ($db, $user) {
        $items = rows($db, ASSESSMENT_SELECT . ' WHERE a.teacher_id=? ORDER BY a.deadline DESC, a.id DESC', [$user['id']]);
        $pending = [];
        foreach (ownPendingAssessmentChanges($db, $user, true) as $change) {
            if ($change['assessment_id'] === null) {
                $id = 'pending-' . $change['id'];
                $items[] = ['id' => $id] + assessmentSnapshot($change['after_entry']);
            } else {
                $id = $change['assessment_id'];
            }
            $pending[$id] = true;
        }
        usort($items, static function ($a, $b) {
            return strcmp($b['deadline'], $a['deadline']) ?: strnatcmp((string) $b['id'], (string) $a['id']);
        });
        return ['items' => formatAssessments($db, $items, $user, null, $pending)];
    });
}

class AssessmentRequestError extends RuntimeException
{
}

function assessmentTransaction($db, $operation)
{
    try {
        return watTransaction($db, function () use ($db, $operation) {
            lockBatch($db, '');
            return $operation();
        });
    } catch (AssessmentRequestError $error) {
        reply(['error' => $error->getMessage()], $error->getCode());
    }
}

// Store stable snapshots so a queued change can be checked again before it is applied.
function assessmentState($row)
{
    if ($row === null) {
        return null;
    }
    return [
        'batch' => $row['batch'],
        'teacher_id' => $row['teacher_id'],
        'subject_id' => isset($row['subject_id']) ? (int) $row['subject_id'] : null,
        'catalog_subject_id' => isset($row['catalog_subject_id']) ? (int) $row['catalog_subject_id'] : null,
        'subject' => $row['subject'],
        'date_given' => $row['date_given'],
        'deadline' => $row['deadline'],
        'description' => $row['description'],
        'assessment_type' => $row['assessment_type'],
        'topic' => $row['topic'],
        'implementation' => $row['implementation'],
        'remarks' => $row['remarks'],
        'stakes' => $row['stakes'] ?? assessmentStakes($row['assessment_type']),
        'audience' => $row['audience'],
        'include_other_grade' => (bool) $row['include_other_grade'],
    ];
}

function assessmentScopes($before, $after)
{
    $scopes = [];
    foreach (array_filter([$before, $after]) as $entry) {
        $start = weekStart($entry['deadline']);
        $batches = [$entry['batch']];
        if ($entry['include_other_grade'] && $entry['audience'] !== 'core') {
            $batches[] = otherSeniorGrade($entry['batch']);
        }
        foreach (array_filter($batches) as $batch) {
            $scopes[$batch . ':' . $start] = compact('batch', 'start');
        }
    }
    return array_values($scopes);
}

function validateAssessmentDeadline($due, $given)
{
    if (!validDate($due)) {
        throw new AssessmentRequestError('Choose a valid deadline.', 400);
    }
    if (isWeekend($due)) {
        throw new AssessmentRequestError('Choose a deadline from Monday to Friday.', 400);
    }
    if ($due < $given) {
        throw new AssessmentRequestError('The deadline must be on or after the date given.', 400);
    }
}

function buildAssessment($db, $user, $input, $old)
{
    $entry = $input + ($old ?? []);
    $batch = $old['batch'] ?? ($entry['batch'] ?? '');
    if (!$old && !in_array($batch, assessmentGroups($db, rows($db, 'SELECT DISTINCT batch FROM wat_batch_advisers')), true)) {
        throw new AssessmentRequestError('Unknown grade level or batch.', 400);
    }

    $given = $entry['date_given'] ?? null;
    $due = $entry['deadline'] ?? null;
    $type = $entry['assessment_type'] ?? '';
    $mode = $entry['implementation'] ?? '';
    $stakes = $entry['stakes'] ?? assessmentStakes($type);
    $topic = $entry['topic'] ?? '';
    $description = $entry['description'] ?? '';
    $remarks = $entry['remarks'] ?? '';
    if (!is_string($topic) || !is_string($description) || !is_string($remarks) || strlen($description) > 65535 ||
        !in_array($type, ['', 'formative', 'alternative', 'summative', 'long_test', 'defense'], true) ||
        !in_array($mode, ['', 'sync', 'async'], true) || !in_array($stakes, ['high', 'low'], true)) {
        throw new AssessmentRequestError('Invalid assessment fields.', 400);
    }
    $topic = trim($topic);
    $description = trim($description);
    $remarks = trim($remarks);
    if (preg_match('/.{256}/su', $topic) || preg_match('/.{4001}/su', $remarks)) {
        throw new AssessmentRequestError('The topic or remarks are too long.', 400);
    }
    $hasTopic = preg_match('/\S/u', $topic) === 1;
    if (!$hasTopic && (!$old || preg_match('/\S/u', $old['topic'] ?? '') === 1)) {
        throw new AssessmentRequestError('Enter the main topic or lesson.', 400);
    }
    if (!validDate($given) || ($given !== ($old['date_given'] ?? null) && isWeekend($given))) {
        throw new AssessmentRequestError('Choose a date given from Monday to Friday.', 400);
    }
    if (!$old || $due !== $old['deadline'] || $given !== $old['date_given']) {
        validateAssessmentDeadline($due, $given);
    }

    $subjectCode = $input['subject_code'] ?? ($old['subject'] ?? null);
    if (!is_string($subjectCode) || $subjectCode === '' || strlen($subjectCode) > 400) {
        throw new AssessmentRequestError('Select a subject from the school catalog.', 400);
    }
    $sameSubject = $old !== null && $subjectCode === $old['subject'];
    $course = findCatalogSubject($db, $batch, $subjectCode);
    if (!$course && !$sameSubject) {
        throw new AssessmentRequestError('Select an active subject for this grade level.', 400);
    }

    $audience = $input['audience'] ?? ($sameSubject ? $old['audience'] : null);
    if ($audience === null) {
        $audience = !$course['core'] ? 'elective' : (!$course['elective'] ? 'core' : 'all');
    }
    $other = otherSeniorGrade($batch);
    $share = $input['include_other_grade'] ?? ($sameSubject ? (bool) $old['include_other_grade'] : null);
    if ($share === null) {
        $share = $other !== null && $course['elective'] && $audience !== 'core';
    }
    if (!in_array($audience, ['all', 'core', 'elective'], true) || !is_bool($share)) {
        throw new AssessmentRequestError('Choose a valid assessment audience.', 400);
    }
    $scopeChanged = !$sameSubject || $audience !== $old['audience'] || $share !== (bool) $old['include_other_grade'];
    if ($scopeChanged && (!$course || ($audience !== 'elective' && !$course['core']) ||
        ($audience !== 'core' && !$course['elective']) ||
        ($share && ($other === null || $audience === 'core' || empty(findCatalogSubject($db, $other, $subjectCode)['elective']))))) {
        throw new AssessmentRequestError('The subject is unavailable for the selected audience.', 400);
    }

    $subjectId = $old['subject_id'] ?? null;
    $catalogSubjectId = $old['catalog_subject_id'] ?? null;
    if (!$sameSubject) {
        $subjectCode = $course['description'];
        $stmt = statement($db, 'INSERT INTO wat_subjects (name) VALUES (?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)', [$subjectCode]);
        $subjectId = $stmt->insert_id;
        $catalogSubjectId = null;
    }
    return assessmentState([
        'batch' => $batch, 'teacher_id' => $old['teacher_id'] ?? $user['id'],
        'subject_id' => $subjectId, 'catalog_subject_id' => $catalogSubjectId, 'subject' => $subjectCode,
        'date_given' => $given, 'deadline' => $due, 'description' => $description, 'assessment_type' => $type ?: null,
        'topic' => $hasTopic ? $topic : null, 'implementation' => $mode ?: null, 'remarks' => $remarks === '' ? null : $remarks,
        'stakes' => $stakes, 'audience' => $audience, 'include_other_grade' => $share,
    ]);
}

function persistAssessment($db, $id, $entry)
{
    if ($entry === null) {
        statement($db, 'DELETE FROM wat_assessments WHERE id=?', [$id]);
        return ['ok' => true];
    }
    unset($entry['subject']);
    $entry['include_other_grade'] = (int) $entry['include_other_grade'];
    $fields = array_keys($entry);
    $values = array_values($entry);
    if ($id !== null) {
        $assignments = implode('=?, ', $fields) . '=?';
        statement($db, "UPDATE wat_assessments SET $assignments WHERE id=?", [...$values, $id]);
        return ['ok' => true];
    }
    $columns = implode(', ', $fields);
    $slots = implode(', ', array_fill(0, count($fields), '?'));
    $stmt = statement($db, "INSERT INTO wat_assessments ($columns) VALUES ($slots)", $values);
    return ['id' => $stmt->insert_id];
}

function saveAssessment($db, $user, $method, $input, $id)
{
    return assessmentTransaction($db, function () use ($db, $user, $method, $input, $id) {
        if ($method === 'POST') {
            $id = null;
            $before = null;
        } else {
            if (!is_scalar($id) || !ctype_digit((string) $id)) {
                throw new AssessmentRequestError('Assessment not found.', 404);
            }
            $before = assessmentState(assessmentRow($db, $id));
            if (!$before || (isset($input['batch']) && $input['batch'] !== $before['batch'])) {
                throw new AssessmentRequestError('Assessment not found.', 404);
            }
            if ($before['teacher_id'] !== $user['id']) {
                throw new AssessmentRequestError('You can only edit your own entries.', 403);
            }
            if (rows($db, "SELECT 1 FROM wat_assessment_changes WHERE assessment_id=? AND status='pending'", [$id])) {
                throw new AssessmentRequestError('A change to this assessment is already awaiting approval.', 409);
            }
        }
        if ($method === 'DELETE') {
            $after = null;
        } elseif ($method === 'PATCH') {
            $due = $input['deadline'] ?? null;
            validateAssessmentDeadline($due, $before['date_given']);
            $after = array_replace($before, ['deadline' => $due]);
        } else {
            $after = buildAssessment($db, $user, $input, $before);
        }
        if ($before === $after) {
            return ['ok' => true];
        }
        return stageAssessmentChange($db, $user, $id, $before, $after) ?? persistAssessment($db, $id, $after);
    });
}
