let start = currentWeekStart();
let loadVersion = 0;
const gradeSelect = $('batch');
const rows = $('rows');
const empty = $('empty');

function gradeNumber(group) {
  return /^Grade (7|8|9|10|11|12)$/.exec(group)?.[1];
}

function showMessage(message) {
  empty.textContent = message;
  empty.hidden = !message;
}

async function load({ reset = false } = {}) {
  const group = gradeSelect.value;
  if (!group) return;
  const version = ++loadVersion;
  const grade = gradeNumber(group);
  if (reset) {
    rows.replaceChildren();
    $('wk').textContent = rangeLabel(start, addDays(start, 6));
    showMessage('Loading assessments…');
  }
  try {
    const week = await api('week', 'GET', null, grade ? { grade, start } : { batch: group, start });
    if (version !== loadVersion) return;
    $('wk').textContent = rangeLabel(week.start, week.end);
    rows.innerHTML = week.items.map((item) =>
      `<tr><td>${esc(item.subject)}</td><td>${fmt(item.date_given)}</td><td>${fmt(item.deadline)}</td><td>${esc(item.description)}</td></tr>`).join('');
    const message = week.visibleToStudents ? 'No assessments this week.' : 'Awaiting batch adviser approval.';
    showMessage(week.items.length ? '' : message);
    $('live').textContent = '● live';
  } catch (error) {
    if (version !== loadVersion) return;
    $('live').textContent = '';
    showMessage(error.message);
  }
}

function changeWeek(nextStart) {
  start = nextStart;
  load({ reset: true });
}

$('prev').onclick = () => changeWeek(addDays(start, -7));
$('next').onclick = () => changeWeek(addDays(start, 7));
$('cur').onclick = () => changeWeek(currentWeekStart());
gradeSelect.onchange = () => {
  try { localStorage.setItem('wat_batch', gradeSelect.value); } catch {}
  load({ reset: true });
};

(async () => {
  const batches = await api('batches');
  if (!batches.length) {
    gradeSelect.replaceChildren(new Option('No grade levels available'));
    showMessage('No grade levels are available.');
    return;
  }
  setGradeOptions(gradeSelect, batches);
  let saved;
  try { saved = localStorage.getItem('wat_batch'); } catch {}
  if (batches.includes(saved)) gradeSelect.value = saved;
  gradeSelect.disabled = false;
  await load({ reset: true });
  watchWeek(load);
})().catch((error) => {
  gradeSelect.replaceChildren(new Option('Grade levels unavailable'));
  showMessage(error.message);
});
