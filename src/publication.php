<?php
const WAT_DEFAULT_LIMITS = ['high' => 2, 'low' => 3];

function lockBatch($db, $batch)
{
    // One lock covers moves and electives that span more than one batch/week.
    rows($db, 'SELECT id FROM wat_schedule_lock WHERE id=1 FOR UPDATE');
}

function watTransaction($db, $operation)
{
    $db->begin_transaction();
    try {
        $result = $operation();
        $db->commit();
        return $result;
    } catch (Throwable $error) {
        $db->rollback();
        throw $error;
    }
}

function batchLimits($db, $batch)
{
    $limits = rows($db, 'SELECT high_limit, low_limit FROM wat_batch_limits WHERE batch=?', [$batch])[0] ?? null;
    return $limits ? ['high' => (int) $limits['high_limit'], 'low' => (int) $limits['low_limit']] : WAT_DEFAULT_LIMITS;
}

function requireWatBatch($db, $batch)
{
    if (!is_string($batch) || !in_array($batch,
        assessmentGroups($db, rows($db, 'SELECT DISTINCT batch FROM wat_batch_advisers')), true)) {
        reply(['error' => 'Choose an available batch.'], 400);
    }
}

function requireBatchAdviser($user, $batch)
{
    if (!is_string($batch) || !canManageBatch($user, $batch)) {
        reply(['error' => 'Only the batch adviser can manage this batch.'], 403);
    }
}

function saveBatchLimits($db, $user, $input)
{
    $batch = $input['batch'] ?? '';
    requireBatchAdviser($user, $batch);
    requireWatBatch($db, $batch);
    $high = $input['high'] ?? null;
    $low = $input['low'] ?? null;
    if (!is_int($high) || !is_int($low) || min($high, $low) < 0 || max($high, $low) > 65535) {
        reply(['error' => 'Enter two whole numbers between 0 and 65,535.'], 400);
    }
    statement($db, 'INSERT INTO wat_batch_limits (batch,high_limit,low_limit) VALUES (?,?,?)
        ON DUPLICATE KEY UPDATE high_limit=VALUES(high_limit), low_limit=VALUES(low_limit)', [$batch, $high, $low]);
    return batchLimits($db, $batch);
}

function setWeekPublication($db, $user, $input)
{
    $batch = $input['batch'] ?? '';
    requireBatchAdviser($user, $batch);
    requireWatBatch($db, $batch);
    $date = $input['start'] ?? '';
    $publish = $input['approved'] ?? null;
    if (!validDate($date) || !is_bool($publish)) {
        reply(['error' => 'Choose a valid week and publication status.'], 400);
    }
    $start = (new DateTimeImmutable($date))->modify('monday this week')->format('Y-m-d');
    return watTransaction($db, function () use ($db, $user, $batch, $start, $publish) {
        lockBatch($db, '');
        if (!$user['isAdmin'] && !rows($db,
            'SELECT 1 FROM wat_batch_advisers WHERE batch=? AND employeeID=?', [$batch, $user['id']])) {
            return ['error' => 'This batch adviser assignment changed.'];
        }
        $queued = 0;
        if ($publish) {
            $insert = statement($db, 'INSERT IGNORE INTO wat_week_approvals (batch,week_start,approved_by) VALUES (?,?,?)',
                [$batch, $start, $user['id']]);
            if ($insert->affected_rows) {
                foreach (promoteAssessmentReviews($db, $batch, $start) as $changeId) {
                    $queued += queueAssessmentChangeNotifications($db, $changeId, [['batch' => $batch, 'start' => $start]]);
                }
                $queued += queueWeekNotification($db, $batch, $start);
            }
        } else {
            statement($db, 'DELETE FROM wat_week_approvals WHERE batch=? AND week_start=?', [$batch, $start]);
            statement($db, "DELETE FROM wat_email_queue WHERE kind='week_published' AND batch=? AND week_start=?
                AND sent_at IS NULL AND claimed_at IS NULL", [$batch, $start]);
        }
        return ['ok' => true, 'mail' => ['queued' => $queued]];
    });
}

function adviserAssignments($db)
{
    $assignments = rows($db, 'SELECT batch, employeeID FROM wat_batch_advisers ORDER BY batch, employeeID');
    $accounts = rows($db, "SELECT employeeID, CONCAT(firstname,' ',lastname) AS name FROM accounts
        WHERE status='active' ORDER BY lastname, firstname, employeeID");
    return ['batches' => assessmentGroups($db, $assignments), 'assignments' => $assignments, 'accounts' => $accounts];
}

function saveAdviserAssignment($db, $input)
{
    $batch = $input['batch'] ?? '';
    requireWatBatch($db, $batch);
    $employeeId = $input['employeeID'] ?? null;
    if (!is_string($employeeId) || ($employeeId !== '' && !rows($db,
        "SELECT 1 FROM accounts WHERE employeeID=? AND status='active'", [$employeeId]))) {
        reply(['error' => 'Choose an active school account.'], 400);
    }
    watTransaction($db, function () use ($db, $batch, $employeeId) {
        lockBatch($db, '');
        statement($db, 'DELETE FROM wat_batch_advisers WHERE batch=?', [$batch]);
        if ($employeeId !== '') {
            statement($db, 'INSERT INTO wat_batch_advisers (batch,employeeID) VALUES (?,?)', [$batch, $employeeId]);
        }
    });
    return adviserAssignments($db);
}
