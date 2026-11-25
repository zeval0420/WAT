<?php
require __DIR__ . '/../../src/session.php';
require __DIR__ . '/../../src/database.php';
require __DIR__ . '/../../src/assessments.php';
require __DIR__ . '/../../src/assessment_changes.php';
require __DIR__ . '/../../src/subject_catalog.php';
require __DIR__ . '/../../src/publication.php';
require __DIR__ . '/../../src/notifications.php';
require __DIR__ . '/../../src/assessment_colors.php';

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];
$routes = [
    'me' => ['GET'], 'logout' => ['POST'], 'batches' => ['GET'], 'week' => ['GET'],
    'subjects' => ['GET'], 'teacherBatches' => ['GET'], 'teacherWeek' => ['GET'], 'approve' => ['POST'],
    'assessment' => ['POST', 'PUT', 'PATCH', 'DELETE'],
    'assessmentColors' => ['GET', 'PUT'], 'teacherSummary' => ['GET'],
    'pendingChanges' => ['GET'], 'reviewChange' => ['POST'], 'batchLimits' => ['PUT'],
    'adviserAssignments' => ['GET', 'PUT'], 'emailTemplates' => ['GET', 'PUT'],
];
if (!is_string($action) || !isset($routes[$action])) {
    reply(['error' => 'Unknown action.'], 404);
}
if (!in_array($method, $routes[$action], true)) {
    header('Allow: ' . implode(', ', $routes[$action]));
    reply(['error' => 'Method not allowed.'], 405);
}
try {
    $public = in_array($action, ['batches', 'week', 'subjects'], true) || ($action === 'assessmentColors' && $method === 'GET');
    if (!$public) {
        startWatSession();
        $csrf = $_SESSION['csrf_token'];
        if ($method !== 'GET') {
            requireCsrf();
        }
        if ($action === 'logout') {
            $_SESSION = [];
            session_destroy();
            reply(['ok' => true]);
        }
        if (!isset($_SESSION['employeeID'])) {
            if ($action === 'me') {
                reply(['user' => null, 'csrf_token' => $csrf]);
            }
            reply(['error' => 'Login required.'], 401);
        }
        $role = $_SESSION['role'] ?? '';
        $user = ['id' => $_SESSION['employeeID'], 'name' => $_SESSION['username'],
            'isAdmin' => ($_SESSION['isBuiltInAdmin'] ?? false) || $_SESSION['employeeID'] === 'admin.controller'];
        session_write_close();
        if ($action === 'me') {
            reply(['user' => $user, 'csrf_token' => $csrf]);
        }
        if (in_array($action, ['assessmentColors', 'adviserAssignments', 'emailTemplates'], true) && !$user['isAdmin']) {
            reply(['error' => 'Only a WAT root admin can manage these settings.'], 403);
        }
    }

    $db = watDatabase();
    if ($action === 'assessmentColors' && $method === 'GET') {
        reply(assessmentColors($db));
    }
    if ($action === 'batches') {
        reply(assessmentGroups($db, rows($db, 'SELECT DISTINCT batch FROM wat_batch_advisers ORDER BY batch')));
    }
    if ($action === 'week') {
        $group = $_GET['batch'] ?? '';
        if (isset($_GET['grade'])) {
            $grade = $_GET['grade'];
            if (!is_string($grade) || assessmentGrade('Grade ' . $grade) === null) {
                reply(['error' => 'Select a grade from 7 to 12.'], 400);
            }
            $group = 'Grade ' . $grade;
        }
        reply(weekData($db, null, $group, $_GET['start'] ?? ''));
    }
    if ($action === 'subjects') {
        $batch = $_GET['batch'] ?? '';
        requireWatBatch($db, $batch);
        reply(subjectCatalog($db, $batch));
    }

    $user['adviserOf'] = array_column(rows($db, 'SELECT batch FROM wat_batch_advisers WHERE employeeID=? ORDER BY batch',
        [$user['id']]), 'batch');
    if (!$user['isAdmin'] && $role !== 'teacher' && !$user['adviserOf']) {
        reply(['error' => 'A teacher or batch adviser account is required.'], 403);
    }
    if ($action === 'teacherBatches') {
        reply(['batches' => assessmentGroups($db, rows($db, 'SELECT DISTINCT batch FROM wat_batch_advisers ORDER BY batch')),
            'adviserOf' => $user['adviserOf']]);
    }
    if ($action === 'teacherWeek') {
        $batch = $_GET['batch'] ?? '';
        requireWatBatch($db, $batch);
        reply(weekData($db, $user, $batch, $_GET['start'] ?? ''));
    }
    if ($action === 'teacherSummary') {
        reply(teacherSummary($db, $user));
    }
    if ($action === 'pendingChanges') {
        $batch = $_GET['batch'] ?? '';
        requireBatchAdviser($user, $batch);
        requireWatBatch($db, $batch);
        reply(pendingAssessmentChanges($db, $user, $batch, $_GET['start'] ?? ''));
    }
    if ($action === 'adviserAssignments' && $method === 'GET') {
        reply(adviserAssignments($db));
    }
    if ($action === 'emailTemplates' && $method === 'GET') {
        reply(emailTemplates($db));
    }

    $input = [];
    if ($method !== 'DELETE') {
        $input = json_decode(file_get_contents('php://input'), true);
        if (!is_array($input) || count(array_filter($input, 'is_array')) > 0) {
            reply(['error' => 'Invalid request body.'], 400);
        }
    }
    switch ($action) {
        case 'assessmentColors':
            reply(saveAssessmentColors($db, $input));
        case 'approve':
            $result = setWeekPublication($db, $user, $input);
            reply($result, isset($result['error']) ? 403 : 200);
        case 'reviewChange':
            reply(reviewAssessmentChange($db, $user, $input));
        case 'batchLimits':
            reply(saveBatchLimits($db, $user, $input));
        case 'adviserAssignments':
            reply(saveAdviserAssignment($db, $input));
        case 'emailTemplates':
            reply(saveEmailTemplate($db, $input));
        case 'assessment':
            if ($method === 'DELETE' && isset($_GET['batch'])) {
                $input['batch'] = $_GET['batch'];
            }
            reply(saveAssessment($db, $user, $method, $input, $_GET['id'] ?? null));
    }
} catch (Throwable $error) {
    error_log(sprintf('WAT %s failed: %s (%s) at %s:%d', $action, get_class($error),
        $error->getCode(), basename($error->getFile()), $error->getLine()));
    if ($error instanceof mysqli_sql_exception) {
        if (in_array($error->getCode(), [1146, 1054], true)) {
            reply(['error' => 'The WAT database schema is incomplete. Apply the WAT database migrations.'], 503);
        }
        if (in_array($error->getCode(), [1044, 1045, 1142, 1143], true)) {
            reply(['error' => 'The database denied WAT access to the requested data.'], 503);
        }
    }
    reply(['error' => 'Could not complete the request.'], 500);
}
