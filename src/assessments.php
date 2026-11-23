<?php
function validDate($value)
{
    if (!is_string($value) || !preg_match('/^\d{4}-\d{2}-\d{2}$/D', $value)) {
        return false;
    }
    [$year, $month, $day] = array_map('intval', explode('-', $value));
    return checkdate($month, $day, $year);
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
    $day = new DateTimeImmutable(validDate($date) ? $date : 'today', new DateTimeZone('UTC'));
    $monday = $day->modify('monday this week');
    $start = $monday->format('Y-m-d');
    $end = $monday->modify('+6 days')->format('Y-m-d');
    $approved = (bool) rows($db, 'SELECT 1 FROM wat_week_approvals WHERE batch=? AND week_start=?', [$batch, $start]);
    $items = [];
    $params = [$batch, $start, $end];
    $sql = ' FROM wat_assessments a JOIN wat_subjects s ON s.id=a.subject_id
             WHERE a.batch=? AND a.deadline BETWEEN ? AND ?';
    $sort = ' ORDER BY a.deadline, s.name';
    if ($user === null) {
        if ($approved) {
            $items = rows($db, 'SELECT a.id, s.name AS subject, a.date_given, a.deadline, a.description' . $sql . $sort, $params);
        }
        return compact('start', 'end', 'approved', 'items');
    }

    $isAdviser = canManageBatch($user, $batch);
    if (!$isAdviser) {
        $sql .= ' AND a.teacher_id=?';
        $params[] = $user['id'];
    }
    $items = rows($db, 'SELECT a.*, s.name AS subject' . $sql . $sort, $params);
    // accounts and the WAT tables use different collations. Look names up separately.
    $ids = array_values(array_unique(array_column($items, 'teacher_id')));
    if ($ids) {
        $slots = implode(',', array_fill(0, count($ids), '?'));
        $names = array_column(rows($db, "SELECT employeeID, CONCAT(firstname, ' ', lastname) AS name
            FROM accounts WHERE employeeID IN ($slots)", $ids), 'name', 'employeeID');
        foreach ($items as &$item) {
            $id = $item['teacher_id'];
            $item['teacher'] = $names[$id] ?? ($id === 'admin.controller' ? $id : '');
        }
        unset($item);
    }
    return compact('start', 'end', 'approved', 'items', 'isAdviser');
}

function saveAssessment($db, $user, $method, $input, $id)
{
    $old = null;
    if ($method !== 'POST') {
        $old = rows($db, 'SELECT * FROM wat_assessments WHERE id=?', [$id])[0] ?? null;
        if (!$old) {
            reply(['error' => 'Assessment not found.'], 404);
        }
        if ($old['teacher_id'] !== $user['id'] && !canManageBatch($user, $old['batch'])) {
            reply(['error' => 'You can only edit your own entries.'], 403);
        }
        if ($method === 'DELETE') {
            statement($db, 'DELETE FROM wat_assessments WHERE id=?', [$id]);
            return ['ok' => true];
        }
    }

    $entry = $input + ($old ?? []);
    $batch = $old['batch'] ?? ($entry['batch'] ?? '');
    $subject = filter_var($entry['subject_id'] ?? null, FILTER_VALIDATE_INT);
    $given = $entry['date_given'] ?? null;
    $due = $entry['deadline'] ?? null;
    $description = trim($entry['description'] ?? '');
    $type = $entry['assessment_type'] ?? '';
    $mode = $entry['implementation'] ?? '';
    $topic = trim($entry['topic'] ?? '');
    $remarks = trim($entry['remarks'] ?? '');
    if (!$batch || !$subject || $subject < 1 || !validDate($given) || !validDate($due) ||
        $due < $given || $description === '' || preg_match('/.{256}/su', $topic) || preg_match('/.{4001}/su', $remarks) ||
        !in_array($type, ['', 'formative', 'summative', 'alternative'], true) ||
        !in_array($mode, ['', 'sync', 'async'], true)) {
        reply(['error' => 'Invalid entry. Check fields and deadline.'], 400);
    }
    $values = [$subject, $given, $due, $description, $type ?: null, $topic === '' ? null : $topic,
        $mode ?: null, $remarks === '' ? null : $remarks];
    if ($old) {
        $values[] = $id;
        statement($db, 'UPDATE wat_assessments SET subject_id=?, date_given=?, deadline=?, description=?,
            assessment_type=?, topic=?, implementation=?, remarks=? WHERE id=?', $values);
        return ['ok' => true];
    }
    if (!rows($db, 'SELECT 1 FROM wat_batch_advisers WHERE batch=? LIMIT 1', [$batch])) {
        reply(['error' => 'Unknown batch.'], 400);
    }
    $values[] = $batch;
    $values[] = $user['id'];
    $stmt = statement($db, 'INSERT INTO wat_assessments (subject_id,date_given,deadline,description,
        assessment_type,topic,implementation,remarks,batch,teacher_id) VALUES (?,?,?,?,?,?,?,?,?,?)', $values);
    return ['id' => $stmt->insert_id];
}
