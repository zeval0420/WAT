<?php
use PHPMailer\PHPMailer\PHPMailer;

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/database.php';
require __DIR__ . '/mail_config.php';

try {
    $config = watMailConfig();
} catch (RuntimeException $error) {
    fwrite(STDERR, $error->getMessage() . PHP_EOL);
    exit(1);
}
require __DIR__ . '/../vendor/autoload.php';
$db = watDatabase();
$sent = 0;
$failed = 0;
$max = isset($argv[1]) ? filter_var($argv[1], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 1000]]) : 100;
if ($max === false) {
    fwrite(STDERR, "Choose a message limit from 1 to 1000.\n");
    exit(1);
}

for ($i = 0; $i < $max; $i++) {
    $token = bin2hex(random_bytes(16));
    $claim = statement($db, 'UPDATE wat_email_queue SET claimed_at=NOW(), claim_token=?, attempts=attempts+1
        WHERE sent_at IS NULL AND available_at<=NOW() AND (claimed_at IS NULL OR claimed_at<DATE_SUB(NOW(), INTERVAL 15 MINUTE))
        ORDER BY id LIMIT 1', [$token]);
    if (!$claim->affected_rows) {
        break;
    }
    $message = rows($db, 'SELECT id, recipient, kind, batch, week_start, subject, body, attempts
        FROM wat_email_queue WHERE claim_token=?', [$token])[0];
    try {
        $base = $message['kind'] === 'week_published' ? $config['student_url'] : $config['teacher_url'];
        $link = $base . (strpos($base, '?') === false ? '?' : '&') . http_build_query([
            'batch' => $message['batch'], 'start' => $message['week_start'],
        ]);
        $mail = new PHPMailer(true);
        $mail->isSMTP();
        $mail->Host = $config['host'];
        $mail->Port = (int) $config['port'];
        $mail->SMTPSecure = $config['encryption'];
        $mail->SMTPAuth = (bool) $config['auth'];
        $mail->Username = $config['username'];
        $mail->Password = $config['password'];
        $mail->Timeout = 15;
        $mail->CharSet = PHPMailer::CHARSET_UTF8;
        $mail->setFrom($config['from'], $config['from_name']);
        $mail->addAddress($message['recipient']);
        $mail->Subject = $message['subject'];
        $mail->Body = str_replace('{{link}}', $link, $message['body']);
        $mail->send();
    } catch (Throwable $error) {
        $delay = min(1440, 5 * (2 ** min(9, (int) $message['attempts'] - 1)));
        statement($db, 'UPDATE wat_email_queue SET available_at=DATE_ADD(NOW(), INTERVAL ? MINUTE),
            claimed_at=NULL, claim_token=NULL WHERE id=? AND claim_token=?', [$delay, $message['id'], $token]);
        fwrite(STDERR, "WAT mail " . $message['id'] . " failed. It will be retried.\n");
        $failed++;
        continue;
    }
    statement($db, 'UPDATE wat_email_queue SET sent_at=NOW(), claimed_at=NULL, claim_token=NULL,
        recipient=\'\', body=\'\' WHERE id=? AND claim_token=?', [$message['id'], $token]);
    $sent++;
}
echo "Sent $sent. Failed $failed.\n";
exit($failed ? 1 : 0);
