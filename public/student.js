let cursor = currentSchoolDate();
let view = 'week';
let loadVersion = 0;
let weeks = new Map();
let loadedSignature = '';
let selectedGrade = '';
let availableGrades = [];
let subjectPreferences = null;
let subjectDialogVersion = 0;
const subjectCatalogByGrade = new Map();
const gradeDialog = $('grade-dialog');
const subjectDialog = $('subject-dialog');
const calendar = $('calendar');
const status = $('calendar-status');
const details = $('day-details');
const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const weekFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const approvalMessage = 'This week hasn’t been published.';
const syncStudentJump = bindCalendarJump($('student-jump'), (date) => {
  cursor = date;
  load({ reset: true });
});

function showMessage(message) {
  if (status.textContent !== message) status.textContent = message;
  status.hidden = !message;
}

function dayData(date) {
  const week = weeks.get(mondayOf(date));
  if (!week) return { items: [], pending: false };
  if (!week.visibleToStudents) return { items: [], pending: true };
  return { items: week.items.filter((item) => item.deadline === date && matchesSubjects(item)), pending: false };
}

function subjectKey(value) {
  return String(value ?? '').trim().toLowerCase();
}

function matchesSubjects(item) {
  if (subjectPreferences?.mode !== 'selected') return true;
  const catalog = subjectCatalogByGrade.get(selectedGrade);
  if (!catalog) return true;
  const key = subjectKey(item.subject);
  const course = catalog.get(key);
  const isCore = !course || (course.core && (!course.coreChoice || subjectPreferences.core.includes(key)));
  const isElective = subjectPreferences.elective.includes(key);
  if (item.audience === 'core') return isCore;
  if (item.audience === 'elective') return isElective;
  return isCore || isElective;
}

function assessmentCards(items) {
  return items.map((item) => `
    <article class="calendar-assessment"${assessmentColorStyle(item.assessment_type)}>
      <h4>${esc(item.subject)}</h4>
      ${assessmentTypeTag(item.assessment_type)}
      ${item.topic ? `<p><strong>${esc(item.topic)}</strong></p>` : ''}
      ${item.description ? `<p>${esc(item.description)}</p>` : ''}
      <small>Given ${fmt(item.date_given)}</small>
    </article>`).join('');
}

function renderDayDetails() {
  details.hidden = view !== 'month' || !weeks.size;
  if (details.hidden) return;
  const { items, pending } = dayData(cursor);
  $('selected-date').textContent = fmt(cursor);
  $('selected-assessments').innerHTML = items.length
    ? assessmentCards(items)
    : `<p class="calendar-day-message">${pending ? approvalMessage : 'No assessments due.'}</p>`;
}

function renderMonthDay(date, items, pending, isToday) {
  const count = items.length;
  const summaries = items.slice(0, 2).map((item) =>
    `<span class="calendar-subject"${assessmentColorStyle(item.assessment_type)}>${esc(item.subject)}</span>`).join('');
  const more = count > 2 ? `<span class="calendar-more">+${count - 2} more</span>` : '';
  const summary = pending ? 'Week unpublished' : `${count} assessment${count === 1 ? '' : 's'} due`;
  return `<button type="button" class="calendar-day${pending ? ' calendar-pending' : ''}"
      data-date="${date}" aria-controls="day-details" aria-pressed="${date === cursor}" ${isToday ? 'aria-current="date"' : ''}
      aria-label="${esc(`${fmt(date)}, ${summary}`)}">
      <span class="calendar-date">${asDate(date).getDate()}</span>
      <span class="calendar-summaries" aria-hidden="true">${summaries}${more}</span>
      ${count ? `<span class="calendar-count" aria-hidden="true">${count}</span>` : ''}
    </button>`;
}

function renderCalendar(period, today) {
  const focusedDate = document.activeElement?.dataset.date;
  const weekdays = period.dates.slice(0, 7).map((date) =>
    `<span class="calendar-weekday" aria-hidden="true">${weekdayFormat.format(asDate(date))}</span>`).join('');
  const days = period.dates.map((date) => {
    if (date < period.start || date > period.end) return '<div class="calendar-outside" aria-hidden="true"></div>';
    const { items, pending } = dayData(date);
    const isToday = date === today;
    if (view === 'month') return renderMonthDay(date, items, pending, isToday);
    return `<section class="calendar-day${pending ? ' calendar-pending' : ''}">
      <h3><time datetime="${date}" ${isToday ? 'aria-current="date"' : ''}>
        <span class="calendar-mobile-weekday">${weekdayFormat.format(asDate(date))}</span>
        <span class="calendar-date">${asDate(date).getDate()}</span>
      </time></h3>
      ${assessmentCards(items)}
    </section>`;
  }).join('');
  calendar.dataset.view = view;
  calendar.innerHTML = weekdays + days;
  if (focusedDate && view === 'month') {
    calendar.querySelector(`[data-date="${focusedDate}"]`)?.focus();
  }
  renderDayDetails();
}

async function load({ reset = false } = {}) {
  const period = calendarPeriod(cursor, view);
  const today = currentSchoolDate();
  const group = selectedGrade;
  const version = ++loadVersion;
  if (reset) {
    weeks = new Map();
    loadedSignature = '';
    $('period').textContent = view === 'month'
      ? monthFormat.format(asDate(period.start))
      : weekFormat.formatRange(asDate(period.start), asDate(period.end));
    syncStudentJump(cursor, view);
    renderCalendar(period, today);
    revealContent(calendar);
    if (group) showMessage('Loading assessments…');
  }
  if (!group) return;

  try {
    const grade = /^Grade (7|8|9|10|11|12)$/.exec(group)?.[1];
    const query = grade ? { grade } : { batch: group };
    const [results] = await Promise.all([
      Promise.all(period.weekStarts.map((start) => api('week', 'GET', null, { ...query, start }))),
      refreshAssessmentColors().catch(() => {}),
    ]);
    if (version !== loadVersion) return;

    const signature = JSON.stringify([today, results, assessmentColors]);
    if (signature !== loadedSignature) {
      loadedSignature = signature;
      weeks = new Map(results.map((week) => [week.start, week]));
      renderCalendar(period, today);
    }
    showWeekStatus(period, results);
  } catch (error) {
    if (version !== loadVersion) return;
    if (weeks.size) {
      weeks = new Map();
      loadedSignature = '';
      renderCalendar(period, today);
    }
    showMessage(error.message);
  }
}

function showWeekStatus(period, results) {
  if (!results.length) return;
  const pending = results.filter((week) => !week.visibleToStudents).length;
  const hasItems = results.some((week) => week.visibleToStudents && week.items.some((item) =>
    item.deadline >= period.start && item.deadline <= period.end && matchesSubjects(item)));
  let message = '';
  if (pending === results.length) message = view === 'week' ? approvalMessage : 'None of these weeks have been published.';
  else if (pending) message = 'Some weeks haven’t been published.';
  else if (!hasItems) message = subjectPreferences?.mode === 'selected'
    ? `No assessments for your subjects this ${view}.` : `No assessments this ${view}.`;
  showMessage(message);
}

function movePeriod(offset) {
  cursor = view === 'month' ? monthStart(cursor, offset) : addDays(cursor, offset * 7);
  load({ reset: true });
}

function changeView(nextView) {
  if (view === nextView) return;
  view = nextView;
  $('week-view').setAttribute('aria-pressed', view === 'week');
  $('month-view').setAttribute('aria-pressed', view === 'month');
  $('prev').setAttribute('aria-label', `Previous ${view}`);
  $('next').setAttribute('aria-label', `Next ${view}`);
  load({ reset: true });
}

calendar.onclick = (event) => {
  const day = event.target.closest('button[data-date]');
  if (!day || day.dataset.date === cursor) return;
  calendar.querySelector('[aria-pressed="true"]')?.setAttribute('aria-pressed', 'false');
  day.setAttribute('aria-pressed', 'true');
  cursor = day.dataset.date;
  syncStudentJump(cursor, view);
  renderDayDetails();
  revealContent(details);
};
$('prev').onclick = () => movePeriod(-1);
$('next').onclick = () => movePeriod(1);
$('cur').onclick = () => {
  cursor = currentSchoolDate();
  load({ reset: true });
};
$('week-view').onclick = () => changeView('week');
$('month-view').onclick = () => changeView('month');

function renderGradeChoices(container, recentGrade = '') {
  const standard = /^Grade (?:[7-9]|1[0-2])$/;
  const grades = availableGrades.filter((name) => standard.test(name));
  const other = availableGrades.filter((name) => !standard.test(name));
  function buttons(names) {
    return `<div class="grade-options">${names.map((name) => `
      <button type="button" data-grade="${esc(name)}"${name === selectedGrade ? ' aria-current="true"' : ''}>
        ${esc(name)}${name === recentGrade ? '<small>Last used</small>' : ''}
      </button>`).join('')}</div>`;
  }
  container.innerHTML = (grades.length ? buttons(grades) : '')
    + (other.length ? '<p class="grade-group-title">Existing batches</p>' + buttons(other) : '');
}

function chooseGrade(grade) {
  const firstChoice = !selectedGrade;
  if (gradeDialog.open) gradeDialog.close();
  if (selectedGrade === grade) return;
  selectedGrade = grade;
  subjectPreferences = savedSubjectPreferences(grade);
  try { localStorage.setItem('wat_batch', grade); } catch {}
  $('active-grade').textContent = grade;
  $('grade-start').hidden = true;
  $('student-calendar-view').hidden = false;
  updateSubjectButton();
  load({ reset: true });
  if (firstChoice) $('calendar-title').focus();
  if (!subjectPreferences) openSubjects();
  else if (subjectPreferences.mode === 'selected') loadSubjectCatalog(grade).catch(() => {});
}

function subjectPreferenceKey(grade) {
  return `wat_subjects:${grade}`;
}

function savedSubjectPreferences(grade) {
  try {
    const saved = JSON.parse(localStorage.getItem(subjectPreferenceKey(grade)));
    if (saved?.mode === 'all') return { mode: 'all' };
    if (saved?.mode === 'selected' && Array.isArray(saved.core) && Array.isArray(saved.elective)
        && [...saved.core, ...saved.elective].every((key) => typeof key === 'string')) return saved;
  } catch {}
  return null;
}

function updateSubjectButton() {
  const filtered = subjectPreferences?.mode === 'selected' && subjectCatalogByGrade.has(selectedGrade);
  $('change-subjects').textContent = filtered ? 'Subjects · Mine' : 'Subjects · All';
}

function refreshSubjects() {
  updateSubjectButton();
  const period = calendarPeriod(cursor, view);
  renderCalendar(period, currentSchoolDate());
  showWeekStatus(period, [...weeks.values()]);
}

async function loadSubjectCatalog(grade) {
  if (subjectCatalogByGrade.has(grade)) return subjectCatalogByGrade.get(grade);
  const subjects = await api('subjects', 'GET', null, { batch: grade });
  const catalog = new Map(subjects.map((course) => [subjectKey(course.description), course]));
  subjectCatalogByGrade.set(grade, catalog);
  if (selectedGrade === grade && subjectPreferences?.mode === 'selected') refreshSubjects();
  return catalog;
}

function subjectFieldset(legend, name, subjects) {
  if (!subjects.length) return '';
  const selected = subjectPreferences?.[name] ?? [];
  return `<fieldset class="subject-options">
    <legend>${legend}</legend>
    ${subjects.map((course) => {
      const key = subjectKey(course.description);
      const title = course.title && course.title !== course.description ? `<small>${esc(course.title)}</small>` : '';
      return `<label><input type="checkbox" name="${name}" value="${esc(key)}"${selected.includes(key) ? ' checked' : ''}>
        <span>${esc(course.description)}${title}</span></label>`;
    }).join('')}
  </fieldset>`;
}

async function openSubjects() {
  const grade = selectedGrade;
  const version = ++subjectDialogVersion;
  const options = $('subject-options');
  const dialogStatus = $('subject-status');
  const save = $('save-subjects');
  options.replaceChildren();
  dialogStatus.textContent = 'Loading subjects…';
  save.disabled = true;
  if (!subjectDialog.open) subjectDialog.showModal();
  try {
    const catalog = await loadSubjectCatalog(grade);
    if (!subjectDialog.open || selectedGrade !== grade || version !== subjectDialogVersion) return;
    const courses = [...catalog.values()];
    const core = courses.filter((course) => course.coreChoice);
    const electives = courses.filter((course) => course.elective);
    options.innerHTML = subjectFieldset('Science Core', 'core', core)
      + subjectFieldset('Electives', 'elective', electives);
    save.disabled = !core.length && !electives.length;
    dialogStatus.textContent = save.disabled
      ? 'This grade has no selectable subjects.' : 'Required subjects are included automatically.';
  } catch (error) {
    if (subjectDialog.open && selectedGrade === grade && version === subjectDialogVersion) {
      dialogStatus.textContent = error.message;
    }
  }
}

function applySubjectPreferences(preferences) {
  subjectPreferences = preferences;
  try { localStorage.setItem(subjectPreferenceKey(selectedGrade), JSON.stringify(preferences)); } catch {}
  subjectDialog.close();
  refreshSubjects();
}

$('change-subjects').onclick = openSubjects;
$('show-all-subjects').onclick = () => applySubjectPreferences({ mode: 'all' });
$('subject-form').onsubmit = (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  applySubjectPreferences({ mode: 'selected', core: form.getAll('core'), elective: form.getAll('elective') });
};
dismissOnBackdrop(subjectDialog);

for (const container of [$('grade-choices'), $('dialog-grade-choices')]) {
  container.addEventListener('click', (event) => {
    const grade = event.target.closest('[data-grade]')?.dataset.grade;
    if (availableGrades.includes(grade)) chooseGrade(grade);
  });
}
$('change-grade').onclick = () => {
  renderGradeChoices($('dialog-grade-choices'));
  gradeDialog.showModal();
  gradeDialog.querySelector('[aria-current="true"]')?.focus();
};
$('cancel-grade').onclick = () => gradeDialog.close();
dismissOnBackdrop(gradeDialog);

async function loadGrades() {
  const status = $('grade-status');
  $('retry-grades').hidden = true;
  status.hidden = false;
  status.textContent = 'Loading grade levels…';
  try {
    availableGrades = await api('batches');
    if (!availableGrades.length) {
      status.textContent = 'No grade levels are available.';
      return;
    }
    let recentGrade;
    try { recentGrade = localStorage.getItem('wat_batch'); } catch {}
    renderGradeChoices($('grade-choices'), recentGrade);
    status.hidden = true;
    const query = new URLSearchParams(location.search);
    const batch = query.get('batch');
    if (availableGrades.includes(batch)) {
      const date = query.get('start');
      if (validCalendarDate(date)) cursor = mondayOf(date);
      chooseGrade(batch);
    }
  } catch (error) {
    status.textContent = error.message;
    $('retry-grades').hidden = false;
  }
}
$('retry-grades').onclick = loadGrades;
loadGrades();
watchWeek(() => { if (selectedGrade) return load(); });
