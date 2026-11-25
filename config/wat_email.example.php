<?php
// For array-based settings, copy to config/email_credentials.php.
// With an existing `$email_smtp_*` file, set WAT_PUBLIC_URL for the mail worker
// or add $wat_public_url to the credentials file to configure the calendar links.
return [
    'host' => 'smtp.example.org',
    'port' => 587,
    'encryption' => 'tls',
    'auth' => true,
    'username' => '',
    'password' => '',
    'from' => 'wat@example.org',
    'from_name' => 'Weekly Assessment Tracker',
    'student_url' => 'https://example.org/WAT/public/',
    'teacher_url' => 'https://example.org/WAT/public/teacher.html',
];
