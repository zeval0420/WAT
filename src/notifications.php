<?php
const WAT_EMAIL_TEMPLATES = [
    'week_published' => [
        'subject' => 'WAT for {{batch}}: {{week_start}}',
        'body' => "The Weekly Assessment Tracker for {{batch}} is published for {{week_start}} through {{week_end}}.\n\n{{schedule}}\n\nOpen the student calendar: {{link}}",
    ],
    'change_requested' => [
        'subject' => 'WAT change for review: {{batch}}, {{week_start}}',
        'body' => "A teacher proposed a change to the published WAT for {{batch}} during the week of {{week_start}}.\n\nRequest #{{change_id}}\nOpen the teacher calendar to review it: {{link}}",
    ],
];

function emailTemplates($db)
{
    $templates = WAT_EMAIL_TEMPLATES;
    foreach (rows($db, 'SELECT kind, subject, body FROM wat_email_templates') as $row) {
        if (isset($templates[$row['kind']])) {
            $templates[$row['kind']] = ['subject' => $row['subject'], 'body' => $row['body']];
        }
    }
    return $templates;
}

function saveEmailTemplate($db, $input)
{
    $kind = $input['kind'] ?? null;
    $subject = $input['subject'] ?? null;
    $body = $input['body'] ?? null;
    if (!is_string($kind) || !isset(WAT_EMAIL_TEMPLATES[$kind]) ||
        !is_string($subject) || trim($subject) === '' || strlen($subject) > 160 || preg_match('/[\x00-\x1f\x7f]/', $subject) ||
        !is_string($body) || trim($body) === '' || strlen($body) > 8000) {
        reply(['error' => 'Enter a subject of up to 160 bytes and a message of up to 8,000 bytes.'], 400);
    }
    statement($db, 'INSERT INTO wat_email_templates (kind,subject,body) VALUES (?,?,?)
        ON DUPLICATE KEY UPDATE subject=VALUES(subject), body=VALUES(body)', [$kind, $subject, $body]);
    return emailTemplates($db);
}

function queueWatEmail($db, $kind, $batch, $start, $recipients, $extra = [])
{
    if (!$recipients) {
        return 0;
    }
    $template = emailTemplates($db)[$kind];
    $replace = [
        '{{batch}}' => $batch, '{{week_start}}' => $start,
        '{{week_end}}' => (new DateTimeImmutable($start))->modify('+6 days')->format('Y-m-d'),
    ];
    $subject = strtr($template['subject'], $replace);
    $body = strtr($template['body'], $replace + $extra);
    if (strlen($body) > 62000) {
        $body = substr($body, 0, 62000);
        while (!preg_match('//u', $body)) {
            $body = substr($body, 0, -1);
        }
        $body .= "\nSee the calendar for more: {{link}}";
    }
    $messages = [];
    $seen = [];
    foreach ($recipients as $email) {
        $email = trim((string) $email);
        $key = strtolower($email);
        if (isset($seen[$key]) || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            continue;
        }
        $seen[$key] = true;
        $messages[] = [$email, $kind, $batch, $start, $subject, $body];
    }
    foreach (array_chunk($messages, 50) as $chunk) {
        $slots = implode(',', array_fill(0, count($chunk), '(?,?,?,?,?,?)'));
        statement($db, "INSERT INTO wat_email_queue (recipient,kind,batch,week_start,subject,body) VALUES $slots",
            array_merge(...$chunk));
    }
    return count($messages);
}

function studentWeekRecipients($db, $batch)
{
    $schoolYear = rows($db, "SELECT value FROM current WHERE description='School Year' ORDER BY id DESC LIMIT 1")[0]['value'] ?? '';
    if ($schoolYear === '') {
        throw new RuntimeException('School Year is missing from the current settings.');
    }
    $grade = assessmentGrade($batch);
    if ($grade === null && preg_match('/^\d{4}$/D', $batch) && preg_match('/^\d{4}-(\d{4})$/D', $schoolYear, $year)) {
        $candidate = 12 - ((int) $batch - (int) $year[1]);
        if ($candidate >= 7 && $candidate <= 12) {
            $grade = (string) $candidate;
        }
    }
    $filter = $grade === null ? 'section=?' : 'gradeLevel=?';
    return array_column(rows($db, "SELECT DISTINCT studentEmail FROM student_directory WHERE sy=? AND $filter",
        [$schoolYear, $grade ?? $batch]), 'studentEmail');
}

function queueWeekNotification($db, $batch, $start)
{
    $recipients = studentWeekRecipients($db, $batch);
    $week = weekData($db, null, $batch, $start);
    $entries = [];
    foreach ($week['items'] as $item) {
        $name = implode(' — ', array_filter([$item['subject'] ?? '', $item['topic'] ?? ''], 'strlen'));
        $audience = ['core' => ' (Core)', 'elective' => ' (Elective)'][$item['audience'] ?? ''] ?? '';
        $entry = $item['deadline'] . ' | ' . $name . $audience;
        if (!empty($item['description'])) {
            $entry .= "\n" . $item['description'];
        }
        $entries[] = $entry;
    }
    $schedule = $entries ? implode("\n\n", $entries) : 'No assessments are scheduled.';
    // Reserve room for the edited template and avoid exceeding the database TEXT limit.
    if (strlen($schedule) > 48000) {
        $schedule = substr($schedule, 0, 48000);
        while (!preg_match('//u', $schedule)) {
            $schedule = substr($schedule, 0, -1);
        }
        $schedule .= "\nSee the calendar for the full schedule.";
    }
    return queueWatEmail($db, 'week_published', $batch, $start, $recipients, ['{{schedule}}' => $schedule]);
}

function queueAssessmentChangeNotifications($db, $changeId, $affected)
{
    $queued = 0;
    foreach ($affected as $scope) {
        // Query separately because the school and WAT tables use different collations.
        $ids = array_column(rows($db, 'SELECT employeeID FROM wat_batch_advisers WHERE batch=?', [$scope['batch']]), 'employeeID');
        if (!$ids) {
            continue;
        }
        $slots = implode(',', array_fill(0, count($ids), '?'));
        $recipients = array_column(rows($db, "SELECT email FROM accounts WHERE status='active' AND employeeID IN ($slots)", $ids), 'email');
        $queued += queueWatEmail($db, 'change_requested', $scope['batch'], $scope['start'], $recipients,
            ['{{change_id}}' => (string) $changeId]);
    }
    return $queued;
}
