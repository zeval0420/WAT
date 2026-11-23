<?php
require __DIR__ . '/../../src/session.php';
require __DIR__ . '/../../src/database.php';
require __DIR__ . '/../../src/assessments.php';

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];
$routes = [
    'me' => ['GET'], 'logout' => ['POST'], 'batches' => ['GET'], 'week' => ['GET'],
    'subjects' => ['GET', 'POST'], 'teacherWeek' => ['GET'], 'approve' => ['POST'],
    'assessment' => ['POST', 'PUT', 'DELETE'],
];
if (!is_string($action) || !isset($routes[$action])) {
    reply(['error' => 'Unknown action.'], 404);
}
if (!in_array($method, $routes[$action], true)) {
    header('Allow: ' . implode(', ', $routes[$action]));
    reply(['error' => 'Method not allowed.'], 405);
}
try {
    if ($action !== 'batches' && $action !== 'week') {
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
        $user = ['id' => $_SESSION['employeeID'], 'name' => $_SESSION['username'],
            'isAdmin' => $_SESSION['employeeID'] === 'admin.controller'];
        session_write_close();
    }

    $db = watDatabase();
    if ($action === 'batches') {
        reply(array_column(rows($db, 'SELECT DISTINCT batch FROM wat_batch_advisers ORDER BY batch'), 'batch'));
    }
    if ($action === 'week') {
        reply(weekData($db, null, $_GET['batch'] ?? '', $_GET['start'] ?? ''));
    }
    $user['adviserOf'] = array_column(rows($db, 'SELECT batch FROM wat_batch_advisers WHERE employeeID=?', [$user['id']]), 'batch');
    if ($action === 'me') {
        reply(['user' => $user, 'csrf_token' => $csrf]);
    }
    if ($action === 'teacherWeek') {
        reply(weekData($db, $user, $_GET['batch'] ?? '', $_GET['start'] ?? ''));
    }
    if ($method === 'GET') {
        reply(rows($db, 'SELECT id, name FROM wat_subjects ORDER BY name'));
    }
    $input = [];
    if ($method !== 'DELETE') {
        $input = json_decode(file_get_contents('php://input'), true);
        if (!is_array($input) || count(array_filter($input, 'is_array')) > 0) {
            reply(['error' => 'Invalid request body.'], 400);
        }
    }
    switch ($action) {
        case 'subjects':
            preg_match('/^.{0,100}/su', trim($input['name'] ?? ''), $match);
            $name = $match[0] ?? '';
            if ($name === '') {
                reply(['error' => 'Name required.'], 400);
            }
            statement($db, 'INSERT IGNORE INTO wat_subjects (name) VALUES (?)', [$name]);
            reply(rows($db, 'SELECT id, name FROM wat_subjects WHERE name=?', [$name])[0]);
        case 'approve':
            $batch = $input['batch'] ?? '';
            $date = $input['start'] ?? '';
            if (!canManageBatch($user, $batch)) {
                reply(['error' => 'Only the batch adviser can approve.'], 403);
            }
            if (!validDate($date) || !is_bool($input['approved'] ?? null)) {
                reply(['error' => 'Invalid week or approval.'], 400);
            }
            $start = (new DateTimeImmutable($date))->modify('monday this week')->format('Y-m-d');
            if ($input['approved']) {
                statement($db, 'INSERT IGNORE INTO wat_week_approvals (batch,week_start,approved_by) VALUES (?,?,?)',
                    [$batch, $start, $user['id']]);
            } else {
                statement($db, 'DELETE FROM wat_week_approvals WHERE batch=? AND week_start=?', [$batch, $start]);
            }
            reply(['ok' => true]);
        case 'assessment':
            reply(saveAssessment($db, $user, $method, $input, $_GET['id'] ?? null));
    }
} catch (Throwable $error) {
    error_log('WAT ' . $action . ' failed: ' . $error->getCode());
    reply(['error' => 'Could not complete the request.'], 500);
}
