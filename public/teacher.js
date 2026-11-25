let start = currentWeekStart();
let cursor = start, calendarView = 'week', activePanel = 'calendar', teacherUser = null;
let items = [], limits = {}, monthWeeks = [], approved = false, loadVersion = 0, saving = false;
let editing = null, editorVersion = 0, editorDirty = false, moving = null, deleting = null;
let editorBatch = '', editorCourses = new Map(), workloadVersion = 0, stakesManuallySet = false;
let summaryVersion = 0;
let dragged = null, dropDay = null, rendered = '';
const sel = $('batch');
const board = $('teacher-board');
const monthBoard = $('teacher-month');
const syncTeacherJump = bindCalendarJump($('teacher-jump'), (date) => showPeriod(date));
const weekendCards = $('weekend-cards');
const editor = $('editor');
const form = $('form');
const moveDialog = $('move-dialog');
const colorDialog = $('color-dialog');
const colorForm = $('color-form');
const deleteDialog = $('delete-dialog');
let openedColors = {};
let colorDialogVersion = 0;
const modes = { sync: 'In Class', async: 'Submission' };
const stakesLabels = { high: 'High Stakes', low: 'Low Stakes' };
const defaultStakes = (type) => type === 'formative' ? 'low' : 'high';
const itemStakes = (item) => Object.hasOwn(stakesLabels, item.stakes) ? item.stakes : defaultStakes(item.assessment_type);
const monthLabel = (date) => new Date(date + 'T00:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const sourceBatch = (item) => item.source_batch || item.batch || sel.value;
const isWeekend = (date) => [0, 6].includes(new Date(date + 'T00:00:00').getDay());
const editIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m14 6 4 4M4 20l4.5-1 11-11a2.8 2.8 0 0 0-4-4l-11 11L4 20Z"/></svg>';
const deleteIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5"/></svg>';

function message(id, text = '') {
  const element = $(id);
  if (element.textContent !== text) element.textContent = text;
  element.hidden = !text;
}

function redirectToLogin() {
  const query = new URLSearchParams(window.location.search);
  const batch = sel.disabled ? query.get('batch') : sel.value;
  const date = sel.disabled ? query.get('start') : start;
  const url = new URL('login.html', window.location.href);
  if (batch) url.searchParams.set('batch', batch);
  if (validCalendarDate(date)) url.searchParams.set('start', date);
  location.replace(url);
}

function tag(value, labels) {
  if (!Object.hasOwn(labels, value)) return '';
  return `<span class="assessment-tag assessment-tag--${value}">${labels[value]}</span>`;
}

function assessmentCard(item, legacy = false) {
  const id = esc(item.id);
  const subject = esc(item.subject);
  return `<article class="calendar-assessment teacher-assessment" draggable="${item.editable === true}" data-assessment="${id}"${assessmentColorStyle(item.assessment_type)}>
    <h4>${subject}</h4>
    <div class="teacher-tags">${assessmentTypeTag(item.assessment_type)}${tag(item.implementation, modes)}${tag(itemStakes(item), stakesLabels)}</div>
    ${item.topic ? `<p class="teacher-topic">${esc(item.topic)}</p>` : ''}
    ${item.description ? `<p>${esc(item.description)}</p>` : ''}
    ${item.remarks ? `<p class="teacher-remarks">Remarks: ${esc(item.remarks)}</p>` : ''}
    <small>${item.implementation === 'async' ? 'Started' : 'Given'} ${fmt(item.date_given)}${legacy ? ` · Due ${fmt(item.deadline)}` : ''}</small>
    ${item.teacher ? `<small class="teacher-byline">${esc(item.teacher)}</small>` : ''}
    ${item.editable === true ? `<div class="teacher-actions">
      <button type="button" class="teacher-icon-button" data-action="edit" aria-label="Edit ${subject}" title="Edit">${editIcon}</button>
      <button type="button" data-action="move" aria-label="Move ${subject}">Move</button>
      <button type="button" class="danger teacher-icon-button" data-action="delete" aria-label="Delete ${subject}" title="Delete">${deleteIcon}</button>
    </div>` : `<small class="teacher-readonly">${item.pending ? 'Awaiting approval' : 'Read only'}</small>`}
  </article>`;
}

function workloadCounts(dayItems, recommendations = {}) {
  const counts = { high: 0, low: 0 };
  dayItems.forEach(item => counts[itemStakes(item)]++);
  return Object.entries(counts).map(([level, count]) => {
    const limit = recommendations[level];
    const hasLimit = limit != null;
    const label = level === 'high' ? 'High' : 'Low';
    return `<span class="${hasLimit && count > limit ? 'teacher-over-limit' : ''}"${hasLimit ? ` title="Recommended maximum of ${esc(limit)}"` : ''}>${label} ${count}${hasLimit ? ` / ${esc(limit)}` : ''}</span>`;
  }).join('');
}

function renderBoard() {
  board.hidden = calendarView !== 'week' || !sel.value;
  monthBoard.hidden = calendarView !== 'month' || !sel.value;
  if (calendarView === 'month') {
    $('weekend-assessments').hidden = true;
    renderMonth();
    return;
  }
  const today = currentSchoolDate();
  const signature = JSON.stringify([start, sel.value, today, items, limits, assessmentColors]);
  if (rendered === signature) return;
  rendered = signature;
  const active = document.activeElement;
  const focusedCard = active?.closest('[data-assessment]')?.dataset.assessment;
  const focusedAction = active?.dataset.action;
  const focusedAdd = active?.dataset.add;
  const days = Array.from({ length: 5 }, (_, index) => addDays(start, index));
  board.innerHTML = days.map((day) => {
    const dayItems = items.filter((item) => item.deadline === day);
    return `<section class="calendar-day teacher-day" data-day="${day}">
    <div class="teacher-day-heading">
      <h3><time datetime="${day}" ${day === today ? 'aria-current="date"' : ''}>${fmt(day)}</time></h3>
      <button type="button" class="teacher-day-add" data-add="${day}" aria-label="Add assessment for ${fmt(day)}">+</button>
    </div>
    <div class="teacher-workload">${workloadCounts(dayItems, limits)}</div>
    ${dayItems.map((item) => assessmentCard(item)).join('')}
  </section>`;
  }).join('');
  const weekend = items.filter((item) => isWeekend(item.deadline));
  $('weekend-assessments').hidden = !weekend.length;
  weekendCards.innerHTML = weekend.map((item) => assessmentCard(item, true)).join('');
  if (focusedCard && focusedAction) {
    const target = document.querySelector(`[data-assessment="${CSS.escape(focusedCard)}"] [data-action="${focusedAction}"]`);
    (target || $('add-assessment')).focus();
  } else if (focusedAdd) {
    board.querySelector(`[data-add="${focusedAdd}"]`)?.focus();
  }
}

function renderMonth() {
  const today = currentSchoolDate();
  const period = calendarPeriod(cursor, 'month');
  const weeks = new Map(monthWeeks.map(week => [week.start, week]));
  const focusedDate = monthBoard.contains(document.activeElement) ? document.activeElement.dataset.date : '';
  const weekdays = Array.from({ length: 7 }, (_, index) =>
    new Date(addDays(mondayOf(period.start), index) + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' }));
  monthBoard.innerHTML = weekdays.map(label => `<div class="calendar-weekday">${esc(label)}</div>`).join('')
    + period.dates.map(date => {
      const monday = mondayOf(date);
      const inMonth = date >= period.start && date <= period.end;
      if (!inMonth) return '<div class="calendar-outside" aria-hidden="true"></div>';
      const week = weeks.get(monday);
      const dayItems = week?.items.filter(item => item.deadline === date) ?? [];
      const total = dayItems.length;
      const countLabel = week ? `, ${total} ${total === 1 ? 'assessment' : 'assessments'}` : '';
      return `<button type="button" class="calendar-day" data-week="${monday}" data-date="${date}" aria-label="Open week of ${esc(fmt(monday))}. ${esc(fmt(date))}${countLabel}">
        <time datetime="${date}" ${date === today ? 'aria-current="date"' : ''}><span class="calendar-date">${Number(date.slice(8))}</span></time>
        ${total ? `<span class="calendar-summaries">${dayItems.slice(0, 3).map(item => `<span class="calendar-subject"${assessmentColorStyle(item.assessment_type)}>${esc(item.subject)}</span>`).join('')}${total > 3 ? `<span class="calendar-more">+${total - 3} more</span>` : ''}</span><span class="calendar-count">${total}</span>` : ''}
      </button>`;
    }).join('');
  if (focusedDate) monthBoard.querySelector(`[data-date="${focusedDate}"]`)?.focus();
}

function clearAdviser() {
  if (typeof renderAdviser === 'function') {
    renderAdviser({ user: teacherUser, batch: '', start, week: null, refresh: load });
  }
}

async function load() {
  if (!sel.value || dragged || activePanel !== 'calendar') return;
  const version = ++loadVersion;
  const batch = sel.value;
  const weekStarts = calendarView === 'week' ? [start] : calendarPeriod(cursor, 'month').weekStarts;
  try {
    const [weeks] = await Promise.all([
      Promise.all(weekStarts.map(date => api('teacherWeek', 'GET', null, { batch, start: date }))),
      refreshAssessmentColors().catch(() => {}),
    ]);
    if (version !== loadVersion || dragged) return;
    message('calendar-error');
    if (calendarView === 'month') {
      monthWeeks = weeks;
      renderBoard();
      return;
    }
    const [week] = weeks;
    items = week.items;
    limits = week.limits || {};
    approved = week.approved;
    const status = $('status');
    status.className = 'pill ' + (week.visibleToStudents ? 'ok' : 'no');
    message('status', week.visibleToStudents ? 'Published' : 'Unpublished');
    const approve = $('approve');
    approve.hidden = !week.isAdviser;
    approve.textContent = approved ? 'Unpublish week' : 'Publish week';
    renderBoard();
    if (typeof renderAdviser === 'function') {
      renderAdviser({ user: teacherUser, batch, start, week, refresh: load });
    }
  } catch (error) {
    if (version !== loadVersion) return;
    if (error.status === 401) redirectToLogin();
    else message('calendar-error', error.message);
  }
}

function showPeriod(date, view = calendarView) {
  calendarView = view;
  cursor = date;
  start = mondayOf(date);
  items = [];
  limits = {};
  monthWeeks = [];
  $('wk').textContent = view === 'week' ? rangeLabel(start, addDays(start, 4)) : monthLabel(date);
  $('teacher-week-view').setAttribute('aria-pressed', String(view === 'week'));
  $('teacher-month-view').setAttribute('aria-pressed', String(view === 'month'));
  $('prev').setAttribute('aria-label', `Previous ${view}`);
  $('next').setAttribute('aria-label', `Next ${view}`);
  $('cur').textContent = view === 'week' ? 'This week' : 'This month';
  $('move-hint').hidden = view !== 'week' || !sel.value;
  syncTeacherJump(cursor, view);
  message('status');
  message('calendar-error');
  message('notice');
  $('approve').hidden = true;
  clearAdviser();
  renderBoard();
  return load();
}

function showWeek(date) {
  return showPeriod(date, 'week');
}

async function boot() {
  const { user } = await api('me');
  if (!user) { redirectToLogin(); return; }
  teacherUser = user;
  $('app').hidden = false;
  $('who').textContent = user.name;
  $('edit-colors').hidden = !user.isAdmin;
  const { batches, adviserOf } = await api('teacherBatches');
  setGradeOptions(sel, batches);
  const query = new URLSearchParams(window.location.search);
  const targetBatch = query.get('batch');
  const targetDate = query.get('start');
  if (batches.includes(targetBatch)) sel.value = targetBatch;
  else if (adviserOf[0]) sel.value = adviserOf[0];
  $('empty').hidden = batches.length > 0;
  sel.disabled = !batches.length;
  $('add-assessment').disabled = !batches.length;
  await showWeek(validCalendarDate(targetDate) ? targetDate : start);
  watchWeek(() => { if (!saving && calendarView === 'week') return load(); });
}

async function loadSubjectOptions(batch, current, version) {
  const select = $('subj');
  editorCourses = new Map();
  select.replaceChildren(new Option('Loading subjects…', ''));
  $('save').disabled = true;
  try {
    const courses = await api('subjects', 'GET', null, { batch });
    if (version !== editorVersion) return;
    editorCourses = new Map(courses.map(course => [course.description, course]));
    select.replaceChildren(new Option(courses.length ? 'Select subject' : 'No active subjects available', ''));
    const codes = new Set(courses.map(course => course.description));
    if (current) codes.add(current);
    for (const code of codes) select.add(new Option(code, code));
    if (current) select.value = current;
    updateAudience(editing?.audience, editing ? editing.include_other_grade : true);
    $('save').disabled = false;
    previewWorkload();
  } catch (error) {
    if (version !== editorVersion) return;
    select.replaceChildren(new Option('Could not load subjects', ''));
    $('ferr').textContent = error.message;
  }
}

function updateAudience(selected, includeOther = true) {
  const course = editorCourses.get($('subj').value);
  const audience = $('subject-audience');
  const core = !!course?.core;
  const elective = !!course?.elective;
  const options = [];
  if (core && elective) options.push(new Option('Core and elective', 'all'));
  if (core) options.push(new Option('Core only', 'core'));
  if (elective) options.push(new Option('Elective only', 'elective'));
  if (!options.length || (selected && !options.some(option => option.value === selected))) {
    options.push(new Option('Current audience', selected || 'all'));
  }
  audience.replaceChildren(...options);
  audience.value = selected || options[0].value;
  $('subject-audience-field').hidden = options.length < 2;
  $('elective-grades').value = includeOther ? 'both' : 'current';
  $('elective-grades').options[1].text = `${editorBatch} only`;
  updateElectiveGrades();
}

function updateElectiveGrades() {
  const course = editorCourses.get($('subj').value);
  $('elective-grades-field').hidden = !otherElectiveBatch() || !course?.elective || $('subject-audience').value === 'core';
}

function otherElectiveBatch() {
  return { 'Grade 11': 'Grade 12', 'Grade 12': 'Grade 11' }[editorBatch];
}

function includeOtherGrade() {
  if (!editorCourses.has($('subj').value) && editing?.subject === $('subj').value) {
    return !!editing.include_other_grade;
  }
  return !$('elective-grades-field').hidden && $('elective-grades').value === 'both';
}

async function previewWorkload() {
  const target = $('editor-workload');
  const due = $('due').value;
  const version = ++workloadVersion;
  if (!validCalendarDate(due) || !editor.open) {
    target.hidden = true;
    return;
  }
  const previewStart = mondayOf(due);
  const batches = [editorBatch];
  if (includeOtherGrade()) batches.push(otherElectiveBatch());
  target.hidden = false;
  target.textContent = 'Loading workload…';
  try {
    const preview = await Promise.all(batches.map(batch => api('teacherWeek', 'GET', null, { batch, start: previewStart })));
    if (version !== workloadVersion || !editor.open) return;
    target.innerHTML = `<h3>Workload for ${rangeLabel(previewStart, addDays(previewStart, 4))}</h3>` + preview.map((week, index) =>
      `<section><h4>${esc(batches[index])}</h4><div class="editor-workload-days">${Array.from({ length: 5 }, (_, offset) => {
        const day = addDays(previewStart, offset);
        const dayItems = week.items.filter(item => item.deadline === day);
        return `<div${day === due ? ' class="editor-workload-selected"' : ''}><h5>${fmt(day)}</h5>
          <div class="teacher-workload">${workloadCounts(dayItems, week.limits)}</div>
          ${dayItems.length ? `<ul>${dayItems.map(item => `<li>${esc(item.subject)}${item.editable ? '' : ` <small>(${item.pending ? 'awaiting approval' : 'read only'})</small>`}</li>`).join('')}</ul>` : ''}
        </div>`;
      }).join('')}</div></section>`).join('');
  } catch (error) {
    if (version === workloadVersion && editor.open) target.textContent = error.message;
  }
}

function dateError(id, error) {
  const input = $(id);
  input.setCustomValidity(error);
  input.setAttribute('aria-invalid', String(Boolean(error)));
  message(`${id}-error`, error);
}

function deadlineError(date, given) {
  if (isWeekend(date)) return 'Choose a deadline from Monday to Friday.';
  if (date && given && date < given) return 'The deadline must be on or after the date given.';
  return '';
}

function validateEditorDates() {
  const given = $('given').value;
  const due = $('due').value;
  dateError('given', given !== editing?.date_given && isWeekend(given)
    ? 'Choose a date from Monday to Friday.' : '');
  const datesUnchanged = due === editing?.deadline && given === editing?.date_given;
  dateError('due', datesUnchanged ? '' : deadlineError(due, given));
}

function openEditor(day, item = null) {
  editing = item;
  editorBatch = item ? sourceBatch(item) : sel.value;
  editorDirty = false;
  form.reset();
  const today = currentSchoolDate();
  const weekday = isWeekend(today) ? addDays(mondayOf(today), 4) : today;
  $('given').value = item?.date_given || (weekday > day ? day : weekday);
  $('due').value = day;
  $('assessment-type').value = item?.assessment_type || '';
  const originalDefault = defaultStakes($('assessment-type').value);
  $('assessment-stakes').value = item?.stakes || originalDefault;
  stakesManuallySet = !!item?.stakes && item.stakes !== originalDefault;
  const topic = $('topic');
  topic.value = item?.topic?.trim() || '';
  topic.required = !item || Boolean(topic.value);
  $('topic-label').textContent = topic.required ? 'Topic / Lesson (required)' : 'Topic / Lesson';
  $('desc').value = item?.description || '';
  $('implementation').value = item?.implementation || '';
  $('remarks').value = item?.remarks || '';
  $('editor-title').textContent = item ? 'Edit assessment' : 'Add assessment';
  $('save').textContent = item ? 'Save changes' : 'Add assessment';
  $('ferr').textContent = '';
  $('subject-audience-field').hidden = $('elective-grades-field').hidden = true;
  $('editor-workload').hidden = true;
  $('implementation').onchange();
  validateEditorDates();
  editor.showModal();
  loadSubjectOptions(editorBatch, item?.subject, ++editorVersion);
}

function openMove(item) {
  moving = item;
  $('move-title').textContent = `Move ${item.subject}`;
  $('move-date').value = isWeekend(item.deadline) ? '' : item.deadline;
  $('move-error').textContent = '';
  dateError('move-date', '');
  moveDialog.showModal();
}

function setSaving(value) {
  saving = value;
  if (value) ++loadVersion;
  for (const id of ['batch', 'prev', 'next', 'cur', 'approve', 'add-assessment', 'out',
    'calendar-tab', 'summary-tab', 'teacher-week-view', 'teacher-month-view',
    'save', 'cancel', 'move-save', 'move-cancel']) {
    $(id).disabled = value;
  }
}

async function refreshAfterSave(due, text) {
  const week = mondayOf(due);
  const refresh = calendarView === 'week' && week === start ? load() : showWeek(week);
  message('notice', text);
  await refresh;
}

function assessmentNotice(result, success) {
  if (!result.pending) return success;
  return result.mail?.queued
    ? 'Change submitted for batch adviser approval. Adviser email queued.'
    : 'Change submitted for batch adviser approval.';
}

async function moveAssessment(item, due, dialog = false) {
  if (saving) return;
  const error = deadlineError(due, item.date_given);
  if (error) { message('calendar-error', error); return; }
  if (due === item.deadline) {
    if (dialog) moveDialog.close();
    return;
  }
  message('calendar-error');
  message('notice');
  setSaving(true);
  try {
    const result = await api('assessment', 'PATCH', { batch: sourceBatch(item), deadline: due }, { id: item.id });
    if (dialog) moveDialog.close();
    await refreshAfterSave(due, assessmentNotice(result, `Assessment moved to ${fmt(due)}.`));
  } catch (error) {
    if (dialog) $('move-error').textContent = error.message;
    else message('calendar-error', error.message);
  } finally {
    setSaving(false);
  }
}

function handleCardClick(event) {
  if (saving) return;
  const add = event.target.closest('[data-add]');
  if (add) { openEditor(add.dataset.add); return; }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const item = items.find((entry) => String(entry.id) === button.closest('[data-assessment]').dataset.assessment);
  if (!item?.editable) return;
  if (button.dataset.action === 'edit') openEditor(item.deadline, item);
  if (button.dataset.action === 'move') openMove(item);
  if (button.dataset.action === 'delete') {
    deleting = item;
    $('delete-detail').textContent = `${item.subject} · Due ${fmt(item.deadline)}`;
    $('delete-error').textContent = '';
    deleteDialog.showModal();
  }
}

async function deleteAssessment(item) {
  message('calendar-error');
  message('notice');
  setSaving(true);
  $('delete-confirm').disabled = $('delete-cancel').disabled = true;
  try {
    const result = await api('assessment', 'DELETE', null, { id: item.id, batch: sourceBatch(item) });
    deleteDialog.close();
    message('notice', assessmentNotice(result, 'Assessment deleted.'));
    await load();
  } catch (error) {
    $('delete-error').textContent = error.message;
  } finally {
    setSaving(false);
    $('delete-confirm').disabled = $('delete-cancel').disabled = false;
    if (!deleteDialog.open && document.activeElement === document.body) {
      const fallback = board.querySelector(`[data-add="${CSS.escape(item.deadline)}"]`) || $('add-assessment');
      fallback.focus();
    }
  }
}

function dragStart(event) {
  const card = event.target.closest('[data-assessment]');
  if (saving || !card || event.target !== card) { event.preventDefault(); return; }
  dragged = items.find((item) => String(item.id) === card.dataset.assessment);
  if (!dragged?.editable) { dragged = null; event.preventDefault(); return; }
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', card.dataset.assessment);
  card.classList.add('is-dragging');
}

function clearDropDay() {
  dropDay?.classList.remove('is-drop-target');
  dropDay = null;
}

function endDrag() {
  document.querySelector('.is-dragging')?.classList.remove('is-dragging');
  clearDropDay();
  dragged = null;
}

for (const container of [board, weekendCards]) {
  container.onclick = handleCardClick;
  container.ondragstart = dragStart;
  container.ondragend = endDrag;
}
board.ondragover = (event) => {
  const day = event.target.closest('[data-day]');
  if (!dragged || !day) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  if (day === dropDay) return;
  clearDropDay();
  dropDay = day;
  dropDay.classList.add('is-drop-target');
};
board.ondragleave = (event) => {
  if (dropDay && !dropDay.contains(event.relatedTarget)) clearDropDay();
};
board.ondrop = (event) => {
  const day = event.target.closest('[data-day]');
  if (!dragged || !day) return;
  event.preventDefault();
  const item = dragged;
  endDrag();
  moveAssessment(item, day.dataset.day);
};

$('prev').onclick = () => showPeriod(calendarView === 'week' ? addDays(start, -7) : monthStart(cursor, -1));
$('next').onclick = () => showPeriod(calendarView === 'week' ? addDays(start, 7) : monthStart(cursor, 1));
$('cur').onclick = () => showPeriod(currentSchoolDate());
$('teacher-week-view').onclick = () => { if (calendarView !== 'week') showPeriod(cursor, 'week'); };
$('teacher-month-view').onclick = () => { if (calendarView !== 'month') showPeriod(cursor, 'month'); };
monthBoard.onclick = (event) => {
  const date = event.target.closest('[data-week]')?.dataset.week;
  if (date) {
    showWeek(date);
    $('teacher-week-view').focus();
  }
};
sel.onchange = () => showPeriod(cursor);
$('add-assessment').onclick = () => {
  const today = currentSchoolDate();
  const endOfWeek = addDays(start, 4);
  const currentDay = isWeekend(today) ? addDays(mondayOf(today), 4) : today;
  const first = monthStart(cursor);
  const firstWorkday = isWeekend(first) ? addDays(mondayOf(first), 7) : first;
  const defaultDay = calendarView === 'month'
    ? (monthStart(today) === first && currentDay >= first ? currentDay : firstWorkday)
    : (currentDay >= start && currentDay <= endOfWeek ? currentDay : start);
  openEditor(defaultDay);
};
$('implementation').onchange = () => {
  $('given-label').textContent = $('implementation').value === 'async' ? 'Date started (required)' : 'Date given (required)';
};
$('assessment-type').onchange = () => {
  if (!stakesManuallySet) $('assessment-stakes').value = defaultStakes($('assessment-type').value);
};
$('assessment-stakes').onchange = () => { stakesManuallySet = true; };
$('subj').onchange = () => { updateAudience(); previewWorkload(); };
$('subject-audience').onchange = () => { updateElectiveGrades(); previewWorkload(); };
$('elective-grades').onchange = previewWorkload;
$('given').oninput = validateEditorDates;
$('due').oninput = () => { validateEditorDates(); previewWorkload(); };
$('move-date').oninput = () => dateError('move-date', deadlineError($('move-date').value, moving.date_given));
$('cancel').onclick = () => dismissDialog(editor);
$('move-cancel').onclick = () => moveDialog.close();
$('delete-cancel').onclick = () => deleteDialog.close();
$('delete-form').onsubmit = (event) => {
  event.preventDefault();
  if (!saving) deleteAssessment(deleting);
};
form.addEventListener('input', () => { editorDirty = true; });
editor.onclose = () => { editorVersion++; workloadVersion++; };
editor.oncancel = (event) => {
  if (saving || (editorDirty && !window.confirm('Discard unsaved assessment changes?'))) event.preventDefault();
};
for (const dialog of [moveDialog, deleteDialog]) {
  dialog.oncancel = (event) => { if (saving) event.preventDefault(); };
}
for (const dialog of [editor, moveDialog, deleteDialog, colorDialog]) dismissOnBackdrop(dialog);
$('out').onclick = async () => {
  try { await api('logout', 'POST'); location.replace('login.html'); }
  catch (error) { message('calendar-error', error.message); }
};
$('approve').onclick = async () => {
  message('calendar-error');
  message('notice');
  setSaving(true);
  try {
    const publish = !approved;
    const result = await api('approve', 'POST', { batch: sel.value, start, approved: publish });
    await load();
    const queued = result.mail?.queued || 0;
    message('notice', publish
      ? `Week published.${queued ? ` ${queued} student ${queued === 1 ? 'email' : 'emails'} queued.` : ''}`
      : 'Week unpublished.');
  }
  catch (error) { message('calendar-error', error.message); }
  finally { setSaving(false); }
};

form.onsubmit = async (event) => {
  event.preventDefault();
  if (saving || $('save').disabled) return;
  validateEditorDates();
  if (!form.reportValidity()) return;
  $('ferr').textContent = '';
  setSaving(true);
  const body = {
    batch: editorBatch,
    date_given: $('given').value, deadline: $('due').value,
    assessment_type: $('assessment-type').value, topic: $('topic').value,
    description: $('desc').value, implementation: $('implementation').value,
    remarks: $('remarks').value, stakes: $('assessment-stakes').value,
    audience: $('subject-audience').value, include_other_grade: includeOtherGrade(),
  };
  if ($('subj').value !== editing?.subject) body.subject_code = $('subj').value;
  try {
    const result = editing
      ? await api('assessment', 'PUT', body, { id: editing.id })
      : await api('assessment', 'POST', body);
    editor.close();
    await refreshAfterSave(body.deadline, assessmentNotice(result, editing ? 'Assessment updated.' : 'Assessment added.'));
  } catch (error) {
    $('ferr').textContent = error.message;
  } finally {
    setSaving(false);
  }
};

async function loadSummary() {
  const version = ++summaryVersion;
  const table = $('teacher-summary-table');
  table.hidden = true;
  message('teacher-summary-status', 'Loading assessments…');
  try {
    const { items: summary } = await api('teacherSummary');
    if (version !== summaryVersion || activePanel !== 'summary') return;
    $('teacher-summary-body').innerHTML = summary.map(item => `<tr${assessmentColorStyle(item.assessment_type)}>
      <td><button type="button" class="teacher-summary-date" data-batch="${esc(sourceBatch(item))}" data-week="${esc(item.deadline)}"><time datetime="${esc(item.deadline)}">${esc(fmt(item.deadline))}, ${esc(item.deadline.slice(0, 4))}</time></button></td>
      <td>${esc(sourceBatch(item))}${item.include_other_grade ? ' and ' + (sourceBatch(item) === 'Grade 11' ? 'Grade 12' : 'Grade 11') : ''}</td>
      <td>${esc(item.subject)}</td><td>${esc(item.topic || '')}</td>
      <td>${assessmentTypeTag(item.assessment_type)}</td><td>${tag(itemStakes(item), stakesLabels)}</td>
      <td>${item.pending ? 'Awaiting approval' : ''}</td>
    </tr>`).join('');
    table.hidden = summary.length === 0;
    message('teacher-summary-status', summary.length ? '' : 'You have no assessments.');
  } catch (error) {
    if (version !== summaryVersion || activePanel !== 'summary') return;
    if (error.status === 401) redirectToLogin();
    else message('teacher-summary-status', error.message);
  }
}

function selectPanel(panel, date, batch) {
  activePanel = panel;
  const isCalendar = panel === 'calendar';
  $('calendar-tab').setAttribute('aria-pressed', String(isCalendar));
  $('summary-tab').setAttribute('aria-pressed', String(!isCalendar));
  $('teacher-calendar').hidden = !isCalendar;
  $('teacher-summary').hidden = isCalendar;
  $('teacher-filters').hidden = !isCalendar;
  ++loadVersion;
  ++summaryVersion;
  if (isCalendar) {
    if (batch && [...sel.options].some(option => option.value === batch)) sel.value = batch;
    return date ? showWeek(date) : load();
  }
  return loadSummary();
}

$('calendar-tab').onclick = () => selectPanel('calendar');
$('summary-tab').onclick = () => selectPanel('summary');
$('teacher-summary-body').onclick = (event) => {
  const row = event.target.closest('button[data-week]');
  if (!row) return;
  selectPanel('calendar', row.dataset.week, row.dataset.batch);
  $('calendar-tab').focus();
};
$('move-form').onsubmit = (event) => {
  event.preventDefault();
  $('move-date').oninput();
  if ($('move-form').reportValidity()) moveAssessment(moving, $('move-date').value, true);
};

$('color-fields').innerHTML = Object.entries(assessmentTypes).map(([type, label]) =>
  `<label>${label}<input type="color" name="${type}" disabled></label>`).join('');
$('edit-colors').onclick = async () => {
  const version = ++colorDialogVersion;
  $('color-error').textContent = '';
  $('save-colors').disabled = true;
  for (const type of Object.keys(assessmentTypes)) colorForm.elements[type].disabled = true;
  colorDialog.showModal();
  try {
    const colors = await refreshAssessmentColors();
    if (!colorDialog.open || version !== colorDialogVersion) return;
    for (const type of Object.keys(assessmentTypes)) {
      const field = colorForm.elements[type];
      field.value = colors[type];
      field.disabled = false;
    }
    openedColors = Object.fromEntries(new FormData(colorForm));
    $('save-colors').disabled = false;
  } catch (error) {
    if (colorDialog.open && version === colorDialogVersion) $('color-error').textContent = error.message;
  }
};
$('cancel-colors').onclick = () => colorDialog.close();
colorDialog.oncancel = (event) => { if ($('cancel-colors').disabled) event.preventDefault(); };
colorForm.onsubmit = async (event) => {
  event.preventDefault();
  if ($('save-colors').disabled) return;
  const changed = Object.fromEntries([...new FormData(colorForm)]
    .filter(([type, value]) => value !== openedColors[type]));
  if (!Object.keys(changed).length) { colorDialog.close(); return; }
  $('color-error').textContent = '';
  $('save-colors').disabled = $('cancel-colors').disabled = true;
  try {
    const colors = await api('assessmentColors', 'PUT', changed);
    ++colorRequest;
    assessmentColors = colors;
    renderBoard();
    message('notice', 'Assessment colors saved.');
    colorDialog.close();
  } catch (error) {
    $('color-error').textContent = error.message;
  } finally {
    $('save-colors').disabled = $('cancel-colors').disabled = false;
  }
};
boot().catch((error) => {
  if (error.status === 401) redirectToLogin();
  else { $('app').hidden = false; message('calendar-error', error.message); }
});
