<?php
require __DIR__ . '/../../src/session.php';
require __DIR__ . '/../../src/database.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST' || ($_POST['action'] ?? '') !== 'loginUser') {
    reply(['error' => 'Expected a login form POST.'], 405);
}
startWatSession();
requireCsrf();
header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-store');

$identity = $_POST['email'] ?? '';
$password = $_POST['password'] ?? '';
if (!is_string($identity) || trim($identity) === '' || !is_string($password) || $password === '') {
    reply(['error' => 'Enter your school username or email and password.'], 400);
}
$now = time();
$attempts = $_SESSION['login_attempts'] ?? ['count' => 0, 'first' => $now, 'until' => 0];
if ($attempts['until'] > $now) {
    header('Retry-After: ' . ($attempts['until'] - $now));
    reply(['error' => 'Too many attempts. Please try again shortly.'], 429);
}

$identity = trim($identity);
$isBuiltInAdmin = $identity === WAT_BUILT_IN_ADMIN;
$account = null;
if ($isBuiltInAdmin) {
    $validPassword = strpos($password, "\0") === false
        && password_verify($password, '$2y$12$tiwZxLeols3TMK//qrIrC.XXNdwstNHdsPsSNsmF/RXicRyDPVqWC');
} else {
    $email = strpos($identity, '@') === false ? $identity . '@irc.pshs.edu.ph' : $identity;
    try {
        $db = watDatabase();
        $account = rows($db, "SELECT employeeID, email, firstname, middlename, lastname, position, password
            FROM accounts WHERE email = ? AND status = 'active' LIMIT 1", [$email])[0] ?? null;
    } catch (Throwable $error) {
        error_log('WAT employee login failed: ' . $error->getCode());
        reply(['error' => 'Could not check the school account.'], 500);
    }
    $validPassword = $account && hash_equals((string) $account['password'], md5($password));
}
if (!$validPassword) {
    if ($now - $attempts['first'] > 900) {
        $attempts = ['count' => 0, 'first' => $now, 'until' => 0];
    }
    $attempts['count']++;
    if ($attempts['count'] >= 5) {
        $attempts['until'] = $now + min(900, 30 * (2 ** min(5, $attempts['count'] - 5)));
    }
    $_SESSION['login_attempts'] = $attempts;
    echo ($isBuiltInAdmin || $account) ? 'invalid_password' : 'prompt_create_account';
    exit;
}

if ($isBuiltInAdmin) {
    $role = 'admin';
    $name = WAT_BUILT_IN_ADMIN;
} else {
    $role = 'requester';
    if ($account['position'] === 'Teacher') {
        $role = 'teacher';
    } elseif (in_array($account['position'], ['Sci. Res. Assist.', 'Sci. Research Specialist I'], true)) {
        $role = 'admin';
    }
    $middle = trim($account['middlename'] ?? '');
    preg_match('/^./u', $middle, $initial);
    $name = trim($account['firstname'] . ' ' . (isset($initial[0]) ? $initial[0] . '. ' : '') . $account['lastname']);
}
session_regenerate_id(true);
unset($_SESSION['login_attempts']);
$_SESSION['employeeID'] = $isBuiltInAdmin ? WAT_BUILT_IN_ADMIN : $account['employeeID'];
$_SESSION['email'] = $account['email'] ?? null;
$_SESSION['username'] = $name;
$_SESSION['role'] = $role;
$_SESSION['isBuiltInAdmin'] = $isBuiltInAdmin;
echo $role;
