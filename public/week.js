// shared date helpers (all dates are 'YYYY-MM-DD' strings; weeks start Monday)
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); };
const mondayOf = (s) => { const d = new Date(s + 'T00:00:00'); return addDays(s, -((d.getDay() + 6) % 7)); };
const asDate = (date) => new Date(date + 'T00:00:00');
function monthStart(date, offset = 0) {
  const first = asDate(date.slice(0, 7) + '-01');
  first.setMonth(first.getMonth() + offset);
  return iso(first);
}
function calendarPeriod(date, view) {
  const start = view === 'month' ? monthStart(date) : mondayOf(date);
  const end = view === 'month' ? addDays(monthStart(date, 1), -1) : addDays(start, 6);
  const weekStarts = [];
  const dates = [];
  for (let week = mondayOf(start); week <= end; week = addDays(week, 7)) {
    weekStarts.push(week);
    for (let day = 0; day < 7; day++) dates.push(addDays(week, day));
  }
  return { start, end, weekStarts, dates };
}
function validCalendarDate(date) {
  return typeof date === 'string' && /^[1-9]\d{3}-\d{2}-\d{2}$/.test(date) && iso(asDate(date)) === date;
}
function calendarWeekValue(date) {
  const monday = mondayOf(date);
  const year = addDays(monday, 3).slice(0, 4);
  const first = mondayOf(year + '-01-04');
  const number = (Date.parse(monday) - Date.parse(first)) / (7 * 86400000) + 1;
  return `${year}-W${String(number).padStart(2, '0')}`;
}
function bindCalendarJump(wrapper, onJump) {
  const input = wrapper.querySelector('input');
  let currentDate;
  let currentView;
  input.addEventListener('change', () => {
    let date = input.value;
    if (input.type === 'week' && /^\d{4}-W\d{2}$/.test(date)) {
      const [year, number] = date.split('-W');
      date = addDays(mondayOf(year + '-01-04'), (Number(number) - 1) * 7);
    } else if (input.type === 'month') {
      date += '-01';
    }
    if (validCalendarDate(date)) onJump(currentView === 'month' ? monthStart(date) : mondayOf(date));
    else update(currentDate, currentView);
  });
  function update(date, view) {
    currentDate = date;
    currentView = view;
    if (input.type !== view) {
      input.type = view;
      if (input.type !== view) input.type = 'date';
    }
    input.setAttribute('aria-label', `Jump to ${view}`);
    input.value = input.type === 'week' ? calendarWeekValue(date)
      : input.type === 'month' ? date.slice(0, 7) : date;
  }
  return update;
}
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
function dismissDialog(dialog) {
  if (dialog.open && dialog.dispatchEvent(new Event('cancel', { cancelable: true }))) {
    dialog.close();
  }
}
function dismissOnBackdrop(dialog) {
  let startedOutside = false;
  function outside(event) {
    const { top, right, bottom, left } = dialog.getBoundingClientRect();
    return event.target === dialog && (
      event.clientX < left || event.clientX >= right || event.clientY < top || event.clientY >= bottom
    );
  }
  dialog.addEventListener('pointerdown', (event) => { startedOutside = outside(event); });
  dialog.addEventListener('click', (event) => {
    if (startedOutside && outside(event)) dismissDialog(dialog);
    startedOutside = false;
  });
}
const assessmentTypes = {
  formative: 'Formative Assessment',
  alternative: 'Alternative Assessment',
  summative: 'Summative Assessment',
  long_test: 'Long Test',
  defense: 'Defense',
};
let assessmentColors = {};
let colorRequest = 0;
async function refreshAssessmentColors() {
  const request = ++colorRequest;
  const colors = await api('assessmentColors');
  if (request === colorRequest) assessmentColors = colors;
  return colors;
}
function assessmentColorStyle(type) {
  const color = Object.hasOwn(assessmentTypes, type) ? assessmentColors[type] : '';
  return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)
    ? ` style="--assessment-color: ${color}"` : '';
}
function assessmentTypeTag(type) {
  return Object.hasOwn(assessmentTypes, type)
    ? `<span class="assessment-tag assessment-type-tag">${assessmentTypes[type]}</span>` : '';
}
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
