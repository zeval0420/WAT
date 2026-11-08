let start = mondayOf(iso(new Date())), items = [], editing = null, me = null, isAdviser = false, approved = false;
const sel = $('batch');

async function boot() {
  me = (await api('/api/me')).user;
  $('login').hidden = !!me; $('app').hidden = !me;
  if (!me) return;
  $('who').textContent = me.name;
  const batches = await api('/api/batches');
  sel.innerHTML = batches.map((b) => `<option>${esc(b)}</option>`).join('');
  const own = me.adviserOf.find((b) => batches.includes(b));
  if (own) sel.value = own;
  await loadSubjects();
  resetForm();
  load();
  onLive((m) => { if (m.batch === sel.value && m.week === start) load(); });
}
async function loadSubjects(pick) {
  const s = await api('/api/subjects');
  $('subj').innerHTML = s.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('');
  if (pick) $('subj').value = pick;
}
async function load() {
  if (!sel.value) return;
  let w;
  try { w = await api(`/api/teacher/week?batch=${encodeURIComponent(sel.value)}&start=${start}`); }
  catch (e) { if (e.status === 401) return boot(); throw e; }
  items = w.items; isAdviser = w.isAdviser; approved = w.approved;
  $('wk').textContent = rangeLabel(w.start, w.end);
  const st = $('status'); st.textContent = approved ? 'Visible to students' : 'Not yet approved'; st.className = 'pill ' + (approved ? 'ok' : 'no');
  const ap = $('approve'); ap.hidden = !isAdviser; ap.textContent = approved ? 'Withdraw approval' : 'Approve week'; ap.className = approved ? '' : 'primary';
  $('empty').hidden = items.length > 0;
  $('rows').innerHTML = items.map((a) => `<tr>
    <td>${esc(a.subject)}${isAdviser && a.teacher ? `<div class="live">${esc(a.teacher)}</div>` : ''}</td>
    <td>${fmt(a.date_given)}</td>
    <td>${fmt(a.deadline)}<br><input type="date" value="${a.deadline}" data-move="${a.id}" aria-label="Move deadline"></td>
    <td>${esc(a.description)}</td>
    <td class="acts"><button data-edit="${a.id}">Edit</button><button class="danger" data-del="${a.id}">Delete</button></td></tr>`).join('');
}
function resetForm() {
  editing = null; $('form').reset();
  $('given').value = iso(new Date()); $('due').value = start > iso(new Date()) ? start : iso(new Date());
  $('save').textContent = 'Add entry'; $('cancel').hidden = true; $('ferr').textContent = '';
}
const go = (n) => { start = addDays(start, n); load(); };
$('prev').onclick = () => go(-7); $('next').onclick = () => go(7);
$('cur').onclick = () => { start = mondayOf(iso(new Date())); load(); };
sel.onchange = load;
$('go').onclick = async () => {
  try { await api('/api/login', 'POST', { username: $('u').value, password: $('p').value }); $('p').value = ''; boot(); }
  catch (e) { $('lerr').textContent = e.message; }
};
$('p').onkeydown = (e) => { if (e.key === 'Enter') $('go').click(); };
$('out').onclick = async () => { await api('/api/logout', 'POST'); boot(); };
$('addsubj').onclick = async () => {
  const name = $('newsubj').value.trim(); if (!name) return;
  const s = await api('/api/subjects', 'POST', { name }); $('newsubj').value = ''; await loadSubjects(s.id);
};
$('approve').onclick = async () => {
  await api('/api/teacher/approve', 'POST', { batch: sel.value, start, approved: !approved }); load();
};
$('form').onsubmit = async (e) => {
  e.preventDefault();
  const body = { batch: sel.value, subject_id: $('subj').value, date_given: $('given').value, deadline: $('due').value, description: $('desc').value };
  try {
    if (editing) await api(`/api/teacher/assessments/${editing}`, 'PUT', body); else await api('/api/teacher/assessments', 'POST', body);
    resetForm(); load();
  } catch (err) { $('ferr').textContent = err.message; }
};
$('cancel').onclick = resetForm;
$('rows').onclick = async (e) => {
  const ed = e.target.dataset.edit, del = e.target.dataset.del;
  if (ed) {
    const a = items.find((x) => x.id == ed); editing = a.id;
    $('subj').value = a.subject_id; $('given').value = a.date_given; $('due').value = a.deadline; $('desc').value = a.description;
    $('save').textContent = 'Save changes'; $('cancel').hidden = false; $('form').scrollIntoView({ behavior: 'smooth' });
  } else if (del && confirm('Delete this entry?')) { await api(`/api/teacher/assessments/${del}`, 'DELETE'); load(); }
};
$('rows').onchange = async (e) => { // move: change deadline
  const id = e.target.dataset.move; if (!id || !e.target.value) return;
  try { await api(`/api/teacher/assessments/${id}`, 'PUT', { deadline: e.target.value }); load(); }
  catch (err) { alert(err.message); load(); }
};
boot();
