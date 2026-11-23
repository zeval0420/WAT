let start = mondayOf(iso(new Date()));
let items = [], editing = null, approved = false, loadVersion = 0, saving = false;
const sel = $('batch');
const grid = document.querySelector('.assessment-grid');
const form = $('form');
let subjectCatalog = [];
const types = { formative: 'Formative Assessment', summative: 'Summative Assessment', alternative: 'Alternative Assessment' };
const modes = { sync: 'Synchronous (in class)', async: 'Asynchronous' };
const dayName = new Intl.DateTimeFormat(undefined, { weekday: 'short' });

function showError(error) {
  $('grid-error').hidden = !error;
  $('grid-error').textContent = error?.message || '';
}

async function boot() {
  const me = (await api('me')).user;
  if (!me) { location.replace('login.html'); return; }
  $('app').hidden = false;
  $('who').textContent = me.name;
  const { batches, adviserOf } = await api('teacherBatches');
  setGradeOptions(sel, batches);
  const own = adviserOf[0];
  if (own) sel.value = own;
  $('empty').hidden = batches.length > 0;
  grid.hidden = !batches.length;
  subjectCatalog = await api('subjects');
  await load();
  watchWeek(load);
}

function setSubjectOptions(item) {
  const select = $('subj');
  const grade = /^Grade (7|8|9|10|11|12)$/.exec(sel.value);
  const courses = subjectCatalog.filter(course => !grade || String(course.grade) === grade[1]);
  select.replaceChildren(new Option(courses.length ? 'Select subject' : 'No active subjects available', ''));
  for (const course of courses) {
    const label = course.description ? course.name + ' — ' + course.description : course.name;
    select.add(new Option(label, course.id));
  }
  if (item) {
    const current = item.catalog_subject_id === null ? 'legacy' : String(item.catalog_subject_id);
    if (!Array.from(select.options).some(option => option.value === current)) {
      select.add(new Option(item.subject, current));
    }
    select.value = current;
  }
}

function tag(value, labels) {
  if (!Object.hasOwn(labels, value)) return '';
  return `<span class="assessment-tag assessment-tag--${value}">${labels[value]}</span>`;
}

function renderGrid() {
  for (const group of [...grid.tBodies]) group.remove();
  for (let offset = 0; offset < 7; offset++) {
    const day = addDays(start, offset);
    const entries = items.filter((item) => item.deadline === day);
    const group = grid.createTBody();
    const date = `<th scope="rowgroup" rowspan="${entries.length + 1}"><time datetime="${day}"><strong>${esc(dayName.format(new Date(day + 'T00:00:00')))}</strong>${fmt(day)}</time></th>`;
    group.innerHTML = entries.map((item, index) => `<tr>
      ${index === 0 ? date : ''}
      <td>${tag(item.assessment_type, types)}</td>
      <td>${esc(item.subject)}${item.teacher ? `<div class="live">${esc(item.teacher)}</div>` : ''}</td>
      <td>${esc(item.topic || '')}</td>
      <td>${esc(item.description)}</td>
      <td>${tag(item.implementation, modes)}</td>
      <td>${item.implementation === 'async' ? fmt(item.date_given) : ''}</td>
      <td>${esc(item.remarks || '')}</td>
      <td class="grid-actions"><button type="button" data-edit="${item.id}">Edit</button> <button type="button" class="danger" data-delete="${item.id}">Delete</button></td>
    </tr>`).join('') + `<tr class="grid-add">${entries.length ? '' : date}
      <td colspan="8"><button type="button" data-add="${day}" aria-label="Add assessment for ${fmt(day)}">+ Add assessment</button></td>
    </tr>`;
  }
}

async function load() {
  if (!sel.value) return;
  const version = ++loadVersion;
  try {
    const w = await api('teacherWeek', 'GET', null, { batch: sel.value, start });
    if (version !== loadVersion) return;
    items = w.items;
    approved = w.approved;
    $('wk').textContent = rangeLabel(w.start, w.end);
    $('status').textContent = approved ? 'Visible to students' : 'Not yet approved';
    $('status').className = 'pill ' + (approved ? 'ok' : 'no');
    const approve = $('approve');
    approve.hidden = !w.isAdviser;
    approve.textContent = approved ? 'Withdraw approval' : 'Approve week';
    approve.className = approved ? '' : 'primary';
    renderGrid();
  } catch (error) {
    if (version !== loadVersion) return;
    if (error.status === 401) location.replace('login.html');
    else showError(error);
  }
}

function updateGivenLabel() {
  $('given-label').textContent = $('implementation').value === 'async' ? 'Date started (async)' : 'Date given';
}

function openEditor(day, item) {
  editing = item?.id ?? null;
  form.reset();
  setSubjectOptions(item);
  const today = iso(new Date());
  $('given').value = item?.date_given || (today > day ? day : today);
  $('due').value = day;
  $('assessment-type').value = item?.assessment_type || '';
  $('topic').value = item?.topic || '';
  $('desc').value = item?.description || '';
  $('implementation').value = item?.implementation || '';
  $('remarks').value = item?.remarks || '';
  $('editor-title').textContent = (editing ? 'Edit assessment for ' : 'Add assessment for ') + sel.value;
  $('save').textContent = editing ? 'Save changes' : 'Add assessment';
  $('ferr').textContent = '';
  updateGivenLabel();
  form.hidden = false;
  $('assessment-type').focus();
  form.scrollIntoView({ block: 'nearest' });
}

function changeWeek(nextStart) {
  start = nextStart;
  form.hidden = true;
  items = [];
  for (const group of [...grid.tBodies]) group.remove();
  $('wk').textContent = rangeLabel(start, addDays(start, 6));
  $('status').className = 'pill';
  $('status').textContent = '';
  $('approve').hidden = true;
  showError();
  load();
}
$('prev').onclick = () => changeWeek(addDays(start, -7));
$('next').onclick = () => changeWeek(addDays(start, 7));
$('cur').onclick = () => changeWeek(mondayOf(iso(new Date())));
sel.onchange = () => changeWeek(start);
$('implementation').onchange = updateGivenLabel;
$('cancel').onclick = () => { form.hidden = true; };
$('out').onclick = async () => {
  try { await api('logout', 'POST'); location.replace('login.html'); }
  catch (error) { showError(error); }
};
$('approve').onclick = async () => {
  showError();
  try { await api('approve', 'POST', { batch: sel.value, start, approved: !approved }); await load(); }
  catch (error) { showError(error); }
};
form.onsubmit = async (event) => {
  event.preventDefault();
  if (saving) return;
  saving = $('save').disabled = true;
  $('ferr').textContent = '';
  const body = {
    batch: sel.value,
    date_given: $('given').value, deadline: $('due').value,
    assessment_type: $('assessment-type').value, topic: $('topic').value,
    description: $('desc').value, implementation: $('implementation').value,
    remarks: $('remarks').value,
  };
  if ($('subj').value !== 'legacy') body.catalog_subject_id = $('subj').value;
  try {
    if (editing) await api('assessment', 'PUT', body, { id: editing });
    else await api('assessment', 'POST', body);
    form.hidden = true;
    await load();
  } catch (error) {
    if (form.hidden) showError(error);
    else $('ferr').textContent = error.message;
  } finally {
    saving = $('save').disabled = false;
  }
};
grid.onclick = async (event) => {
  const { add, edit, delete: remove } = event.target.dataset;
  if (saving) return;
  if (add) openEditor(add);
  if (edit) {
    const item = items.find((entry) => String(entry.id) === edit);
    if (item) openEditor(item.deadline, item);
  }
  if (remove && confirm('Delete this assessment?')) {
    showError();
    try {
      await api('assessment', 'DELETE', null, { id: remove, batch: sel.value });
      if (String(editing) === remove) form.hidden = true;
      await load();
    } catch (error) { showError(error); }
  }
};
boot().catch((error) => { $('app').hidden = false; showError(error); });
