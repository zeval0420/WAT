let cursor = currentSchoolDate();
let view = 'week';
let loadVersion = 0;
let weeks = new Map();
let loadedSignature = '';
const gradeSelect = $('batch');
const calendar = $('calendar');
const status = $('calendar-status');
const details = $('day-details');
const asDate = (date) => new Date(date + 'T00:00:00');
const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const weekFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const approvalMessage = 'Awaiting batch adviser approval.';

function monthStart(date, offset = 0) {
  const first = asDate(date.slice(0, 7) + '-01');
  first.setMonth(first.getMonth() + offset);
  return iso(first);
}

function calendarPeriod() {
  const start = view === 'month' ? monthStart(cursor) : mondayOf(cursor);
  const end = view === 'month' ? addDays(monthStart(cursor, 1), -1) : addDays(start, 6);
  const weekStarts = [];
  const dates = [];
  for (let week = mondayOf(start); week <= end; week = addDays(week, 7)) {
    weekStarts.push(week);
    for (let day = 0; day < 7; day++) dates.push(addDays(week, day));
  }
  return { start, end, weekStarts, dates };
}

function showMessage(message) {
  if (status.textContent !== message) status.textContent = message;
  status.hidden = !message;
}

function dayData(date) {
  const week = weeks.get(mondayOf(date));
  if (!week) return { items: [], pending: false };
  if (!week.visibleToStudents) return { items: [], pending: true };
  return { items: week.items.filter((item) => item.deadline === date), pending: false };
}

function assessmentCards(items) {
  return items.map((item) => `
    <article class="calendar-assessment"${assessmentColorStyle(item.assessment_type)}>
      <h4>${esc(item.subject)}</h4>
      ${assessmentTypeTag(item.assessment_type)}
      <p>${esc(item.description)}</p>
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
  const summary = pending ? 'Awaiting batch adviser approval' : `${count} assessment${count === 1 ? '' : 's'} due`;
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
  const period = calendarPeriod();
  const today = currentSchoolDate();
  const group = gradeSelect.disabled ? '' : gradeSelect.value;
  const version = ++loadVersion;
  if (reset) {
    weeks = new Map();
    loadedSignature = '';
    $('period').textContent = view === 'month'
      ? monthFormat.format(asDate(period.start))
      : weekFormat.formatRange(asDate(period.start), asDate(period.end));
    renderCalendar(period, today);
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
    const pending = results.filter((week) => !week.visibleToStudents).length;
    const hasItems = results.some((week) => week.visibleToStudents &&
      week.items.some((item) => item.deadline >= period.start && item.deadline <= period.end));
    let message = hasItems ? '' : `No assessments this ${view}.`;
    if (pending) message = pending === results.length ? approvalMessage : 'Some weeks are awaiting batch adviser approval.';
    showMessage(message);
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
  if (!day) return;
  calendar.querySelector('[aria-pressed="true"]')?.setAttribute('aria-pressed', 'false');
  day.setAttribute('aria-pressed', 'true');
  cursor = day.dataset.date;
  renderDayDetails();
};
$('prev').onclick = () => movePeriod(-1);
$('next').onclick = () => movePeriod(1);
$('cur').onclick = () => {
  cursor = currentSchoolDate();
  load({ reset: true });
};
$('week-view').onclick = () => changeView('week');
$('month-view').onclick = () => changeView('month');
gradeSelect.onchange = () => {
  try { localStorage.setItem('wat_batch', gradeSelect.value); } catch {}
  load({ reset: true });
};

(async () => {
  load({ reset: true });
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
