let start = mondayOf(iso(new Date()));
const sel = $('batch');

let loadVersion = 0;
async function load() {
  if (!sel.value) return;
  const version = ++loadVersion;
  const w = await api('week', 'GET', null, { batch: sel.value, start });
  if (version !== loadVersion) return;
  $('wk').textContent = rangeLabel(w.start, w.end);
  $('rows').innerHTML = w.items.map((a) =>
    `<tr><td>${esc(a.subject)}</td><td>${fmt(a.date_given)}</td><td>${fmt(a.deadline)}</td><td>${esc(a.description)}</td></tr>`).join('');
  const e = $('empty');
  e.hidden = w.items.length > 0;
  e.textContent = w.approved ? 'No assessments this week.' : 'This week’s list has not been approved yet.';
}
const go = (n) => { start = addDays(start, n); load(); };
$('prev').onclick = () => go(-7);
$('next').onclick = () => go(7);
$('cur').onclick = () => { start = mondayOf(iso(new Date())); load(); };
sel.onchange = () => {
  try { localStorage.setItem('wat_batch', sel.value); } catch {}
  $('rows').replaceChildren();
  $('empty').hidden = true;
  load().catch((error) => { $('empty').textContent = error.message; $('empty').hidden = false; });
};

(async () => {
  const batches = await api('batches');
  setGradeOptions(sel, batches);
  let saved; try { saved = localStorage.getItem('wat_batch'); } catch {}
  if (batches.includes(saved)) sel.value = saved;
  if (!batches.length) $('empty').textContent = 'No batches set up yet.';
  const refresh = async () => {
    try { await load(); $('live').textContent = '● live'; }
    catch { $('live').textContent = ''; }
  };
  await refresh();
  watchWeek(refresh);
})().catch((error) => {
  $('empty').hidden = false;
  $('empty').textContent = error.message;
});
