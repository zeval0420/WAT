<?php
function watDatabase()
{
    require dirname(__DIR__, 2) . '/credentials/db_connection.php';
    mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
    return $conn;
}

function statement($db, $sql, $values = [])
{
    $stmt = $db->prepare($sql);
    if ($values) {
        $stmt->bind_param(str_repeat('s', count($values)), ...$values);
    }
    $stmt->execute();
    return $stmt;
}

function rows($db, $sql, $values = [])
{
    return statement($db, $sql, $values)->get_result()->fetch_all(MYSQLI_ASSOC);
}
