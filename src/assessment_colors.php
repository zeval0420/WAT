<?php
const WAT_ASSESSMENT_COLORS = [
    'formative' => '#15803d',
    'summative' => '#b45309',
    'alternative' => '#2563eb',
    'long_test' => '#7c3aed',
    'defense' => '#be185d',
];

function assessmentColors($db)
{
    try {
        $colors = array_column(rows($db, 'SELECT assessment_type, color FROM wat_assessment_colors'), 'color', 'assessment_type');
    } catch (mysqli_sql_exception $error) {
        if ($error->getCode() !== 1146) {
            throw $error;
        }
        return WAT_ASSESSMENT_COLORS;
    }
    return array_replace(WAT_ASSESSMENT_COLORS, array_intersect_key($colors, WAT_ASSESSMENT_COLORS));
}

function saveAssessmentColors($db, $input)
{
    foreach ($input as $type => $color) {
        if (!isset(WAT_ASSESSMENT_COLORS[$type]) || !is_string($color) || !preg_match('/^#[0-9a-f]{6}$/iD', $color)) {
            reply(['error' => 'Choose a valid color for a listed assessment type.'], 400);
        }
    }
    if ($input) {
        $placeholders = implode(', ', array_fill(0, count($input), '(?, ?)'));
        $values = [];
        foreach ($input as $type => $color) {
            $values[] = $type;
            $values[] = strtolower($color);
        }
        statement($db, "INSERT INTO wat_assessment_colors (assessment_type, color) VALUES $placeholders
            ON DUPLICATE KEY UPDATE color=VALUES(color)", $values);
    }
    return assessmentColors($db);
}
