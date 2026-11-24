// shared date helpers (all dates are 'YYYY-MM-DD' strings; weeks start Monday)
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); };
const mondayOf = (s) => { const d = new Date(s + 'T00:00:00'); return addDays(s, -((d.getDay() + 6) % 7)); };
const schoolDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
});
function currentSchoolDate() {
  const parts = Object.fromEntries(schoolDate.formatToParts(new Date()).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function currentWeekStart() {
  return mondayOf(currentSchoolDate());
}
const fmt = (s) => new Date(s + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const rangeLabel = (a, b) => `${fmt(a)} – ${fmt(b)}`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (id) => document.getElementById(id);
function setGradeOptions(select, batches) {
  const grades = document.createElement('optgroup');
  grades.label = 'Grade levels';
  const legacy = document.createElement('optgroup');
  legacy.label = 'Existing batches';
  for (const batch of batches) {
    const group = /^Grade (?:[7-9]|1[0-2])$/.test(batch) ? grades : legacy;
    group.append(new Option(batch, batch));
  }
  select.replaceChildren(grades);
  if (legacy.children.length) select.append(legacy);
}
let csrfToken = '';
async function api(action, method = 'GET', body, query = {}) {
  const url = new URL('ajax/wat.php', window.location.href);
  url.search = new URLSearchParams({ ...query, action });
  const headers = { Accept: 'application/json' };
  if (method !== 'GET') headers['X-CSRF-Token'] = csrfToken;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(url, { method, headers, body: body && JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || 'Request failed.'), { status: response.status });
  if (data.csrf_token) csrfToken = data.csrf_token;
  return data;
}

// PHP requests are independent. Refresh open weeks while their tab is visible.
function watchWeek(refresh) {
  let pending = false;
  const update = async () => {
    if (document.hidden || pending) return;
    pending = true;
    try { await refresh(); }
    finally { pending = false; }
  };
  document.addEventListener('visibilitychange', update);
  window.setInterval(update, 5000);
}
