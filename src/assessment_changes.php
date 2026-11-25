<?php
function ownPendingAssessmentChanges($db, $user, $includeAdds = false)
{
    $sql = $includeAdds
        ? "SELECT id, assessment_id, after_entry FROM wat_assessment_changes WHERE requested_by=? AND status='pending'"
        : "SELECT assessment_id FROM wat_assessment_changes WHERE requested_by=? AND status='pending' AND assessment_id IS NOT NULL";
    return rows($db, $sql, [$user['id']]);
}

function stageAssessmentChange($db, $user, $id, $before, $after)
{
    $scopes = assessmentScopes($before, $after);
    $affected = [];
    foreach ($scopes as $scope) {
        if (rows($db, 'SELECT 1 FROM wat_week_approvals WHERE batch=? AND week_start=?', [$scope['batch'], $scope['start']])) {
            $affected[] = $scope;
        }
    }
    if (!$affected) {
        return null;
    }

    $stmt = statement($db, 'INSERT INTO wat_assessment_changes (assessment_id, requested_by, before_entry, after_entry)
        VALUES (?,?,?,?)', [$id, $user['id'],
        $before === null ? null : json_encode($before, JSON_THROW_ON_ERROR),
        $after === null ? null : json_encode($after, JSON_THROW_ON_ERROR)]);
    $changeId = $stmt->insert_id;
    foreach ($scopes as $scope) {
        $decision = in_array($scope, $affected, true) ? 'pending' : 'unpublished';
        statement($db, 'INSERT INTO wat_assessment_change_reviews (change_id, batch, week_start, decision) VALUES (?,?,?,?)',
            [$changeId, $scope['batch'], $scope['start'], $decision]);
    }
    $queued = queueAssessmentChangeNotifications($db, $changeId, $affected);
    return ['pending' => true, 'change_id' => $changeId, 'affected' => $affected, 'mail' => ['queued' => $queued]];
}

// A week can be published between two reviews of the same change.
function promoteAssessmentReviews($db, $batch, $start)
{
    $changes = rows($db, "SELECT r.change_id
        FROM wat_assessment_change_reviews r
        JOIN wat_assessment_changes c ON c.id=r.change_id
        WHERE r.batch=? AND r.week_start=? AND r.decision='unpublished' AND c.status='pending'", [$batch, $start]);
    foreach ($changes as $change) {
        statement($db, "UPDATE wat_assessment_change_reviews SET decision='pending'
            WHERE change_id=? AND batch=? AND week_start=?", [$change['change_id'], $batch, $start]);
    }
    return array_column($changes, 'change_id');
}

function pendingAssessmentChanges($db, $user, $batch, $date)
{
    if (!is_string($batch) || $batch === '' || !validDate($date)) {
        reply(['error' => 'Select a batch and week.'], 400);
    }
    if (!canManageBatch($user, $batch)) {
        reply(['error' => 'Only the batch adviser can review changes for this batch.'], 403);
    }
    $items = rows($db, "SELECT c.id, c.requested_by, c.before_entry, c.after_entry, c.created_at,
            (SELECT COUNT(*) FROM wat_assessment_change_reviews other
                WHERE other.change_id=c.id AND other.decision='pending') AS outstanding_reviews
        FROM wat_assessment_changes c JOIN wat_assessment_change_reviews r ON r.change_id=c.id
        WHERE r.batch=? AND r.week_start=? AND r.decision='pending' AND c.status='pending'
        ORDER BY c.created_at, c.id", [$batch, weekStart($date)]);
    foreach ($items as &$item) {
        $item['before'] = assessmentSnapshot($item['before_entry']);
        $item['after'] = assessmentSnapshot($item['after_entry']);
        unset($item['before_entry'], $item['after_entry']);
    }
    unset($item);
    return compact('items');
}

function assessmentSnapshot($json)
{
    return $json === null ? null : assessmentState(json_decode($json, true, 512, JSON_THROW_ON_ERROR));
}

function reviewAssessmentChange($db, $user, $input)
{
    $id = $input['id'] ?? null;
    $batch = $input['batch'] ?? '';
    $date = $input['start'] ?? '';
    $approve = $input['approve'] ?? null;
    if ((!is_int($id) && !is_string($id)) || !ctype_digit((string) $id) ||
        !is_string($batch) || $batch === '' || !validDate($date) || !is_bool($approve)) {
        reply(['error' => 'Invalid change, batch, week, or decision.'], 400);
    }
    if (!canManageBatch($user, $batch)) {
        reply(['error' => 'Only the batch adviser can review changes for this batch.'], 403);
    }

    $start = weekStart($date);
    return assessmentTransaction($db, function () use ($db, $user, $id, $batch, $start, $approve) {
        if (!$user['isAdmin'] && !rows($db, 'SELECT 1 FROM wat_batch_advisers WHERE batch=? AND employeeID=?', [$batch, $user['id']])) {
            throw new AssessmentRequestError('This batch adviser assignment changed.', 403);
        }
        $change = rows($db, "SELECT c.* FROM wat_assessment_changes c
            JOIN wat_assessment_change_reviews r ON r.change_id=c.id
            WHERE c.id=? AND c.status='pending' AND r.batch=? AND r.week_start=? AND r.decision='pending'",
            [$id, $batch, $start])[0] ?? null;
        if (!$change) {
            throw new AssessmentRequestError('This change is no longer awaiting review for this week.', 409);
        }

        $decision = $approve ? 'approved' : 'rejected';
        statement($db, 'UPDATE wat_assessment_change_reviews SET decision=?, reviewed_by=?, reviewed_at=CURRENT_TIMESTAMP
            WHERE change_id=? AND batch=? AND week_start=?', [$decision, $user['id'], $id, $batch, $start]);
        if ($approve && rows($db, "SELECT 1 FROM wat_assessment_change_reviews WHERE change_id=? AND decision='pending' LIMIT 1", [$id])) {
            return ['ok' => true, 'pending' => true];
        }
        if ($approve) {
            $assessmentId = $change['assessment_id'];
            $before = assessmentSnapshot($change['before_entry']);
            if ($assessmentId !== null && assessmentState(assessmentRow($db, $assessmentId)) !== $before) {
                throw new AssessmentRequestError('The original assessment changed after this request was submitted. Reject this request and enter the change again.', 409);
            }
            $result = persistAssessment($db, $assessmentId, assessmentSnapshot($change['after_entry']));
            $assessmentId = $assessmentId ?? ($result['id'] ?? null);
            statement($db, 'UPDATE wat_assessment_changes SET assessment_id=? WHERE id=?', [$assessmentId, $id]);
        }
        statement($db, 'UPDATE wat_assessment_changes SET status=?, resolved_at=CURRENT_TIMESTAMP WHERE id=?', [$decision, $id]);
        return ['ok' => true, 'pending' => false];
    });
}
