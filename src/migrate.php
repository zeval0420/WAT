<?php
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require __DIR__ . '/database.php';
$db = watDatabase();
foreach (glob(__DIR__ . '/../sql/*.sql') as $file) {
    $db->multi_query(file_get_contents($file));
    do {
        $result = $db->store_result();
        if ($result) {
            $result->free();
        }
    } while ($db->more_results() && $db->next_result());
    echo 'applied ', basename($file), PHP_EOL;
}
