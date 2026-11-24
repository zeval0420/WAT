let start = currentWeekStart();
let items = [], approved = false, loadVersion = 0, saving = false;
let editing = null, editorVersion = 0, editorDirty = false, moving = null, deleting = null;
let dragged = null, dropDay = null, rendered = '';
const sel = $('batch');
const board = $('teacher-board');
const weekendCards = $('weekend-cards');
const editor = $('editor');
const form = $('form');
const moveDialog = $('move-dialog');
const colorDialog = $('color-dialog');
const colorForm = $('color-form');
const deleteDialog = $('delete-dialog');
let openedColors = {};
let colorDialogVersion = 0;
const modes = { sync: 'Synchronous', async: 'Asynchronous' };
const isWeekend = (date) => [0, 6].includes(new Date(date + 'T00:00:00').getDay());
const editIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m14 6 4 4M4 20l4.5-1 11-11a2.8 2.8 0 0 0-4-4l-11 11L4 20Z"/></svg>';
const deleteIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5"/></svg>';

function message(id, text = '') {
  const element = $(id);
  if (element.textContent !== text) element.textContent = text;
  element.hidden = !text;
}

function tag(value, labels) {
  if (!Object.hasOwn(labels, value)) return '';
  return `<span class="assessment-tag assessment-tag--${value}">${labels[value]}</span>`;
}

function assessmentCard(item, legacy = false) {
  const id = esc(item.id);
  const subject = esc(item.subject);
  return `<article class="calendar-assessment teacher-assessment" draggable="true" data-assessment="${id}"${assessmentColorStyle(item.assessment_type)}>
    <h4>${subject}</h4>
    <div class="teacher-tags">${assessmentTypeTag(item.assessment_type)}${tag(item.implementation, modes)}</div>
    ${item.topic ? `<p class="teacher-topic">${esc(item.topic)}</p>` : ''}
    ${item.description ? `<p>${esc(item.description)}</p>` : ''}
    ${item.remarks ? `<p class="teacher-remarks">Remarks: ${esc(item.remarks)}</p>` : ''}
    <small>${item.implementation === 'async' ? 'Started' : 'Given'} ${fmt(item.date_given)}${legacy ? ` · Due ${fmt(item.deadline)}` : ''}</small>
    ${item.teacher ? `<small class="teacher-byline">${esc(item.teacher)}</small>` : ''}
    <div class="teacher-actions">
      <button type="button" class="teacher-icon-button" data-action="edit" aria-label="Edit ${subject}" title="Edit">${editIcon}</button>
      <button type="button" data-action="move" aria-label="Move ${subject}">Move</button>
      <button type="button" class="danger teacher-icon-button" data-action="delete" aria-label="Delete ${subject}" title="Delete">${deleteIcon}</button>
    </div>
  </article>`;
}

function renderBoard() {
  const today = currentSchoolDate();
  const signature = JSON.stringify([start, sel.value, today, items, assessmentColors]);
  if (rendered === signature) return;
  rendered = signature;
  const active = document.activeElement;
  const focusedCard = active?.closest('[data-assessment]')?.dataset.assessment;
  const focusedAction = active?.dataset.action;
  const focusedAdd = active?.dataset.add;
  const days = Array.from({ length: 5 }, (_, index) => addDays(start, index));
  board.innerHTML = days.map((day) => `<section class="calendar-day teacher-day" data-day="${day}">
    <div class="teacher-day-heading">
      <h3><time datetime="${day}" ${day === today ? 'aria-current="date"' : ''}>${fmt(day)}</time></h3>
      <button type="button" class="teacher-day-add" data-add="${day}" aria-label="Add assessment for ${fmt(day)}">+</button>
    </div>
    ${items.filter((item) => item.deadline === day).map((item) => assessmentCard(item)).join('')}
  </section>`).join('');
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

async function load() {
  if (!sel.value || dragged) return;
  const version = ++loadVersion;
  try {
    const [week] = await Promise.all([
      api('teacherWeek', 'GET', null, { batch: sel.value, start }),
      refreshAssessmentColors().catch(() => {}),
    ]);
    if (version !== loadVersion || dragged) return;
    items = week.items;
    approved = week.approved;
    const status = $('status');
    status.className = 'pill ' + (week.visibleToStudents ? 'ok' : 'no');
    message('status', week.visibleToStudents ? 'Visible to students' : 'Awaiting batch adviser approval');
    const approve = $('approve');
    approve.hidden = !week.isAdviser || !week.requiresApproval;
    approve.textContent = approved ? 'Withdraw approval' : 'Approve week';
    renderBoard();
  } catch (error) {
    if (version !== loadVersion) return;
    if (error.status === 401) location.replace('login.html');
    else message('calendar-error', error.message);
  }
}

function showWeek(nextStart) {
  start = nextStart;
  items = [];
  $('wk').textContent = rangeLabel(start, addDays(start, 4));
  message('status');
  message('calendar-error');
  message('notice');
  $('approve').hidden = true;
  renderBoard();
  return load();
}

async function boot() {
  const { user } = await api('me');
  if (!user) { location.replace('login.html'); return; }
  $('app').hidden = false;
  $('who').textContent = user.name;
  $('edit-colors').hidden = !user.isAdmin;
  const { batches, adviserOf } = await api('teacherBatches');
  setGradeOptions(sel, batches);
  if (adviserOf[0]) sel.value = adviserOf[0];
  $('empty').hidden = batches.length > 0;
  $('move-hint').hidden = !batches.length;
  board.hidden = !batches.length;
  sel.disabled = !batches.length;
  $('add-assessment').disabled = !batches.length;
  $('wk').textContent = rangeLabel(start, addDays(start, 4));
  await load();
  watchWeek(() => { if (!saving) return load(); });
}

async function loadSubjectOptions(batch, current, version) {
  const select = $('subj');
  select.replaceChildren(new Option('Loading subjects…', ''));
  $('save').disabled = true;
  try {
    const courses = await api('subjects', 'GET', null, { batch });
    if (version !== editorVersion) return;
    select.replaceChildren(new Option(courses.length ? 'Select subject' : 'No active subjects available', ''));
    const codes = new Set(courses.map(course => course.description));
    if (current) codes.add(current);
    for (const code of codes) select.add(new Option(code, code));
    if (current) select.value = current;
    $('save').disabled = false;
  } catch (error) {
    if (version !== editorVersion) return;
    select.replaceChildren(new Option('Could not load subjects', ''));
    $('ferr').textContent = error.message;
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
  dateError('due', deadlineError(due, given));
}

function openEditor(day, item = null) {
  editing = item;
  editorDirty = false;
  form.reset();
  const today = currentSchoolDate();
  const weekday = isWeekend(today) ? addDays(mondayOf(today), 4) : today;
  $('given').value = item?.date_given || (weekday > day ? day : weekday);
  $('due').value = day;
  $('assessment-type').value = item?.assessment_type || '';
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
  $('implementation').onchange();
  validateEditorDates();
  editor.showModal();
  loadSubjectOptions(sel.value, item?.subject, ++editorVersion);
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
    'save', 'cancel', 'move-save', 'move-cancel']) {
    $(id).disabled = value;
  }
}

async function refreshAfterSave(due, text) {
  const week = mondayOf(due);
  const refresh = week === start ? load() : showWeek(week);
  message('notice', text);
  await refresh;
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
    await api('assessment', 'PATCH', { batch: sel.value, deadline: due }, { id: item.id });
    if (dialog) moveDialog.close();
    await refreshAfterSave(due, `Assessment moved to ${fmt(due)}.`);
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
  if (!item) return;
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
    await api('assessment', 'DELETE', null, { id: item.id, batch: sel.value });
    deleteDialog.close();
    message('notice', 'Assessment deleted.');
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
  if (!dragged) { event.preventDefault(); return; }
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

$('prev').onclick = () => showWeek(addDays(start, -7));
$('next').onclick = () => showWeek(addDays(start, 7));
$('cur').onclick = () => showWeek(currentWeekStart());
sel.onchange = () => showWeek(start);
$('add-assessment').onclick = () => {
  const today = currentSchoolDate();
  const defaultDay = mondayOf(today) === start ? (isWeekend(today) ? addDays(start, 4) : today) : start;
  openEditor(defaultDay);
};
$('implementation').onchange = () => {
  $('given-label').textContent = $('implementation').value === 'async' ? 'Date started (required)' : 'Date given (required)';
};
for (const id of ['given', 'due']) $(id).oninput = validateEditorDates;
$('move-date').oninput = () => dateError('move-date', deadlineError($('move-date').value, moving.date_given));
$('cancel').onclick = () => dismissDialog(editor);
$('move-cancel').onclick = () => moveDialog.close();
$('delete-cancel').onclick = () => deleteDialog.close();
$('delete-form').onsubmit = (event) => {
  event.preventDefault();
  if (!saving) deleteAssessment(deleting);
};
form.addEventListener('input', () => { editorDirty = true; });
editor.onclose = () => { editorVersion++; };
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
  try { await api('approve', 'POST', { batch: sel.value, start, approved: !approved }); await load(); }
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
    batch: sel.value,
    date_given: $('given').value, deadline: $('due').value,
    assessment_type: $('assessment-type').value, topic: $('topic').value,
    description: $('desc').value, implementation: $('implementation').value,
    remarks: $('remarks').value,
  };
  if ($('subj').value !== editing?.subject) body.subject_code = $('subj').value;
  try {
    if (editing) await api('assessment', 'PUT', body, { id: editing.id });
    else await api('assessment', 'POST', body);
    editor.close();
    await refreshAfterSave(body.deadline, editing ? 'Assessment updated.' : 'Assessment added.');
  } catch (error) {
    $('ferr').textContent = error.message;
  } finally {
    setSaving(false);
  }
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
boot().catch((error) => { $('app').hidden = false; message('calendar-error', error.message); });
