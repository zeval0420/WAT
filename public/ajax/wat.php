<?php
require __DIR__ . '/../../src/session.php';
require __DIR__ . '/../../src/database.php';
require __DIR__ . '/../../src/assessments.php';

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];
$routes = [
    'me' => ['GET'], 'logout' => ['POST'], 'batches' => ['GET'], 'week' => ['GET'],
    'subjects' => ['GET', 'POST'], 'teacherBatches' => ['GET'], 'teacherWeek' => ['GET'], 'approve' => ['POST'],
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
        if ($action === 'me') {
            reply(['user' => $user, 'csrf_token' => $csrf]);
        }
    }

    $db = watDatabase();
    if ($action === 'batches') {
        reply(array_column(rows($db, 'SELECT DISTINCT batch FROM wat_batch_advisers ORDER BY batch'), 'batch'));
    }
    if ($action === 'week') {
        reply(weekData($db, null, $_GET['batch'] ?? '', $_GET['start'] ?? ''));
    }
    if ($action === 'teacherBatches') {
        $batches = rows($db, 'SELECT batch, MAX(employeeID=?) AS advises FROM wat_batch_advisers GROUP BY batch ORDER BY batch', [$user['id']]);
        reply(['batches' => array_column($batches, 'batch'),
            'adviserOf' => array_column(array_filter($batches, static function ($row) { return $row['advises']; }), 'batch')]);
    }
    if (in_array($action, ['teacherWeek', 'assessment', 'approve'], true)) {
        $user['adviserOf'] = array_column(rows($db, 'SELECT batch FROM wat_batch_advisers WHERE employeeID=?', [$user['id']]), 'batch');
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
