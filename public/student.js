let start = mondayOf(iso(new Date()));
const sel = $('batch');

async function load() {
  if (!sel.value) return;
  const w = await api(`/api/week?batch=${encodeURIComponent(sel.value)}&start=${start}`);
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
sel.onchange = () => { try { localStorage.setItem('wat_batch', sel.value); } catch {} load(); };

(async () => {
  const batches = await api('/api/batches');
  sel.innerHTML = batches.map((b) => `<option>${esc(b)}</option>`).join('');
  let saved; try { saved = localStorage.getItem('wat_batch'); } catch {}
  if (batches.includes(saved)) sel.value = saved;
  if (!batches.length) $('empty').textContent = 'No batches set up yet.';
  load();
  const es = onLive((m) => { if (m.batch === sel.value && m.week === start) load(); });
  es.onopen = () => { $('live').textContent = '● live'; load(); };
  es.onerror = () => { $('live').textContent = ''; };
})();
