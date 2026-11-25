<?php

function subjectCatalog($db, $batch, $code = null)
{
    $grade = assessmentGrade($batch);
    $senior = in_array($grade, ['11', '12'], true);
    $sql = "SELECT subjectCode, subjectDescription, subjectAcademicUnit, subjectGradeLevel
            FROM subject WHERE status='active'";
    $params = [];
    if ($grade !== null) {
        if ($senior) {
            $sql .= ' AND subjectGradeLevel IN (\'11\', \'12\')';
        } else {
            $sql .= ' AND subjectGradeLevel=?';
            $params[] = $grade;
        }
    }
    if ($code !== null) {
        $sql .= ' AND subjectCode=?';
        $params[] = $code;
    }

    $courses = [];
    foreach (rows($db, $sql . ' ORDER BY subjectCode, id', $params) as $row) {
        $name = trim($row['subjectCode']);
        if ($name === '' || $name === '-' || strcasecmp($name, 'Elective') === 0) {
            continue;
        }
        $title = trim($row['subjectDescription']);
        $choice = preg_match('/^science\s+core\s+\d+\s*\(/i', $name) === 1
            || preg_match('/^science\s+core\s+\d+\s*\(/i', $title) === 1;
        $explicitElective = preg_match('/\belective\b/i', "$name $title") === 1;
        $ownGrade = $grade === null || (string) $row['subjectGradeLevel'] === $grade;
        $core = $ownGrade && (!$explicitElective || $choice);
        // Senior elective offerings are shared. Concrete Science Core subjects may serve either audience.
        $elective = $explicitElective || ($choice && in_array((string) $row['subjectGradeLevel'], ['11', '12'], true));
        if (!$core && !$elective) {
            continue;
        }
        $key = strtolower($name);
        $course = $courses[$key] ?? [
            'description' => $name,
            'unit' => $row['subjectAcademicUnit'],
            'title' => $title,
            'core' => false,
            'elective' => false,
            'coreChoice' => false,
        ];
        if ($ownGrade && !$course['core']) {
            $course['unit'] = $row['subjectAcademicUnit'];
            $course['title'] = $title;
        }
        $course['core'] = $course['core'] || $core;
        $course['elective'] = $course['elective'] || $elective;
        $course['coreChoice'] = $course['coreChoice'] || ($core && $choice);
        $courses[$key] = $course;
    }
    return array_values($courses);
}

function findCatalogSubject($db, $batch, $code)
{
    return subjectCatalog($db, $batch, $code)[0] ?? null;
}
