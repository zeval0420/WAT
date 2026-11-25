<?php
function watMailConfig()
{
    $localPath = dirname(__DIR__) . '/config/email_credentials.php';
    $path = getenv('WAT_EMAIL_CONFIG') ?: (is_file($localPath)
        ? $localPath : dirname(__DIR__, 2) . '/credentials/wat_email.php');
    if (!is_file($path) || !is_readable($path)) {
        throw new RuntimeException('WAT email credentials file is missing or unreadable.');
    }

    $settings = require $path;
    $settings = is_array($settings) ? $settings : [
        'host' => $email_smtp_host ?? '',
        'port' => $email_smtp_port ?? null,
        'encryption' => $email_smtp_secure ?? '',
        'auth' => true,
        'username' => $email_smtp_user ?? '',
        'password' => $email_smtp_password ?? '',
        'from' => $email_sender ?? '',
        'public_url' => $wat_public_url ?? '',
    ];
    $settings += ['from_name' => 'Weekly Assessment Tracker'];
    $base = getenv('WAT_PUBLIC_URL') ?: ($settings['public_url'] ?? '');
    if (is_string($base) && filter_var($base, FILTER_VALIDATE_URL) && strpbrk($base, '?#') === false) {
        $base = rtrim($base, '/') . '/';
        $settings += ['student_url' => $base, 'teacher_url' => $base . 'teacher.html'];
    }
    foreach (['student_url', 'teacher_url'] as $key) {
        $url = $settings[$key] ?? '';
        if (!is_string($url) || !filter_var($url, FILTER_VALIDATE_URL) || strpos($url, '#') !== false ||
            !in_array(parse_url($url, PHP_URL_SCHEME), ['https', 'http'], true)) {
            throw new RuntimeException('Set WAT_PUBLIC_URL to the deployed student calendar directory, or configure both calendar URLs.');
        }
    }
    if (empty($settings['host']) || !filter_var($settings['from'] ?? '', FILTER_VALIDATE_EMAIL) ||
        !filter_var($settings['port'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 65535]]) ||
        !in_array($settings['encryption'] ?? null, ['', 'ssl', 'tls'], true) ||
        (!empty($settings['auth']) && (empty($settings['username']) || empty($settings['password'])))) {
        throw new RuntimeException('WAT SMTP settings are incomplete or invalid.');
    }
    return $settings + ['auth' => false, 'username' => '', 'password' => ''];
}
