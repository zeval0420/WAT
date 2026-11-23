<?php
// WAT's Node process reads this output through a private pipe.
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

// The shared include may print a connection error and exit. Only emit the config on success.
ob_start(static fn ($output) => '');
require __DIR__ . '/../../credentials/db_connection.php';
$config = [
    'host' => $servername,
    'user' => $username,
    'password' => $password,
    'database' => $database,
    'charset' => $conn->character_set_name(),
    'port' => (int) ini_get('mysqli.default_port'),
];
if (str_contains($conn->host_info, 'UNIX socket') && ini_get('mysqli.default_socket')) {
    $config['socketPath'] = ini_get('mysqli.default_socket');
}
$conn->close();
ob_end_clean();
echo json_encode($config, JSON_THROW_ON_ERROR);
