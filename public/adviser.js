let adviserContext;
let adviserRequest = 0;

function showAdviserMessage(element, text, error = false) {
  element.textContent = text;
  element.classList.toggle('err', error);
}

function setupAdviserControls(container) {
  container.innerHTML = `
    <section class="card adviser-panel">
      <h3>Daily recommendations</h3>
      <form id="limit-form" class="adviser-limits">
        <label>High stakes <input id="high-limit" type="number" min="0" max="65535" required></label>
        <label>Low stakes <input id="low-limit" type="number" min="0" max="65535" required></label>
        <button type="submit">Save limits</button>
      </form>
      <p id="limit-feedback" role="status"></p>
      <h3>Changes awaiting review</h3>
      <div id="pending-changes" aria-live="polite"></div>
      <p id="review-feedback" role="status"></p>
    </section>`;
  const form = $('limit-form');
  form.addEventListener('input', () => { form.dataset.dirty = 'true'; });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const context = adviserContext;
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      await api('batchLimits', 'PUT', {
        batch: context.batch, high: $('high-limit').valueAsNumber, low: $('low-limit').valueAsNumber,
      });
      if (context.batch === adviserContext.batch) {
        delete form.dataset.dirty;
        showAdviserMessage($('limit-feedback'), 'Recommendations saved.');
        await context.refresh();
      }
    } catch (error) {
      if (context.batch === adviserContext.batch) showAdviserMessage($('limit-feedback'), error.message, true);
    } finally {
      button.disabled = false;
    }
  });
}

function reviewEntry(entry) {
  if (!entry) return '<p>None</p>';
  const type = Object.hasOwn(assessmentTypes, entry.assessment_type) ? assessmentTypes[entry.assessment_type] : '';
  const stakes = entry.stakes === 'low' ? 'Low stakes' : 'High stakes';
  const audience = { core: 'Core', elective: 'Elective', all: 'All applicable students' }[entry.audience];
  const fields = [
    ['Subject', entry.subject], ['Grade / batch', entry.batch], ['Date given', entry.date_given],
    ['Deadline', entry.deadline], ['Type', type], ['Stakes', stakes],
    ['Audience', [audience, entry.include_other_grade ? 'Shared across Grades 11 and 12' : ''].filter(Boolean).join(' · ')],
    ['Implementation', { sync: 'In Class', async: 'Submission' }[entry.implementation]],
    ['Topic', entry.topic], ['Description', entry.description], ['Remarks', entry.remarks],
  ];
  return `<dl>${fields.filter(([, value]) => value).map(([label, value]) =>
    `<dt>${label}</dt><dd>${esc(value)}</dd>`).join('')}</dl>`;
}

async function renderAdviser(context) {
  const previous = adviserContext;
  adviserContext = context;
  const request = ++adviserRequest;
  const root = $('root-controls');
  if (root) {
    root.hidden = !context.user?.isAdmin;
    if (!root.hidden && !root.firstChild) setupRootControls(root);
  }
  const container = $('adviser-controls');
  if (!container) return;
  container.hidden = !context.week?.isAdviser;
  if (container.hidden) return;
  if (!$('limit-form')) setupAdviserControls(container);
  const form = $('limit-form');
  if (form.dataset.batch !== context.batch) {
    form.dataset.batch = context.batch;
    delete form.dataset.dirty;
    showAdviserMessage($('limit-feedback'), '');
  }
  if (!form.dataset.dirty && context.week.limits) {
    $('high-limit').value = context.week.limits.high;
    $('low-limit').value = context.week.limits.low;
  }
  const list = $('pending-changes');
  const changedWeek = previous?.batch !== context.batch || previous?.start !== context.start;
  if (changedWeek || !list.firstChild) {
    list.textContent = 'Loading changes…';
    showAdviserMessage($('review-feedback'), '');
  }
  try {
    const { items } = await api('pendingChanges', 'GET', undefined, { batch: context.batch, start: context.start });
    if (request !== adviserRequest) return;
    if (!changedWeek && list.dataset.items === JSON.stringify(items) && list.querySelector('article, p')) return;
    list.dataset.items = JSON.stringify(items);
    list.innerHTML = items.length ? items.map((item) => `
      <article class="adviser-change">
        <h4>${item.before ? (item.after ? 'Edit assessment' : 'Delete assessment') : 'Add assessment'} · Request #${esc(item.id)}</h4>
        <p>Requested by ${esc(item.requested_by)}</p>
        <div class="adviser-comparison">
          <div><h5>Current</h5>${reviewEntry(item.before)}</div>
          <div><h5>Proposed</h5>${reviewEntry(item.after)}</div>
        </div>
        <div class="adviser-buttons">
          <button class="primary" type="button" data-approve="yes" data-id="${esc(item.id)}">Approve change</button>
          <button type="button" data-approve="no" data-id="${esc(item.id)}">Reject change</button>
        </div>
      </article>`).join('') : '<p>No changes awaiting your review for this week.</p>';
    list.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', () => decideAdviserChange(button, context));
    });
  } catch (error) {
    if (request === adviserRequest) list.textContent = error.message;
  }
}

async function decideAdviserChange(button, context) {
  const group = Array.from(button.closest('.adviser-buttons').querySelectorAll('button'));
  group.forEach((control) => { control.disabled = true; });
  const sameWeek = () => context.batch === adviserContext.batch && context.start === adviserContext.start;
  const approve = button.dataset.approve === 'yes';
  try {
    const result = await api('reviewChange', 'POST', { id: Number(button.dataset.id), approve, batch: context.batch, start: context.start });
    if (sameWeek()) {
      const message = approve
        ? (result.pending ? 'Approval recorded. Another review is required.' : 'Change approved.')
        : 'Change rejected.';
      showAdviserMessage($('review-feedback'), message);
      await context.refresh();
    }
  } catch (error) {
    if (sameWeek()) showAdviserMessage($('review-feedback'), error.message, true);
  } finally {
    group.forEach((control) => { control.disabled = false; });
  }
}

function setupRootControls(container) {
  container.innerHTML = `
    <button type="button" id="open-wat-admin">Administration</button>
    <dialog id="wat-admin" class="card app-dialog teacher-dialog" aria-labelledby="wat-admin-title">
      <div class="wat-admin-content">
        <h2 id="wat-admin-title">WAT administration</h2>
        <form id="assign-adviser-form" class="form">
          <h3 class="wide">Batch adviser</h3>
          <label>Batch <select id="assign-batch" required></select></label>
          <label>Adviser <select id="assign-account"></select></label>
          <div class="wide"><button type="submit">Save adviser</button></div>
          <p class="wide" id="assign-feedback" role="status"></p>
        </form>
        <form id="email-template-form" class="form">
          <h3 class="wide">Email notifications</h3>
          <label class="wide">Notification
            <select id="template-kind">
              <option value="week_published">Published week for students</option>
              <option value="change_requested">Proposed change for the adviser</option>
            </select>
          </label>
          <label class="wide">Subject <input id="template-subject" type="text" maxlength="160" required></label>
          <label class="wide">Message <textarea id="template-body" rows="8" maxlength="8000" required></textarea></label>
          <p id="template-fields" class="wide"></p>
          <div class="wide"><button type="submit">Save template</button></div>
          <p class="wide" id="template-feedback" role="status"></p>
        </form>
        <button type="button" id="close-wat-admin">Close</button>
      </div>
    </dialog>`;
  const dialog = $('wat-admin');
  const assignments = $('assign-adviser-form');
  const templates = $('email-template-form');
  const batch = $('assign-batch');
  const account = $('assign-account');
  const kind = $('template-kind');
  let assignmentData, templateData;

  function displayAssignment() {
    const existing = assignmentData.assignments.filter((entry) => entry.batch === batch.value);
    account.value = existing[0]?.employeeID ?? '';
    showAdviserMessage($('assign-feedback'),
      existing.length > 1 ? 'Several advisers are assigned. Saving will replace them with the selected adviser.' : '');
  }

  function displayTemplate() {
    const selected = templateData[kind.value];
    $('template-subject').value = selected.subject;
    $('template-body').value = selected.body;
    const detail = kind.value === 'week_published' ? '{{schedule}}' : '{{change_id}}';
    $('template-fields').textContent =
      `Subject fields: {{batch}}, {{week_start}}, {{week_end}}. Message fields also include ${detail} and {{link}}.`;
    showAdviserMessage($('template-feedback'), '');
  }

  $('open-wat-admin').addEventListener('click', async () => {
    assignments.hidden = true;
    templates.hidden = true;
    dialog.showModal();
    const results = await Promise.allSettled([api('adviserAssignments'), api('emailTemplates')]);
    const [advisers, email] = results;
    if (advisers.status === 'fulfilled') {
      assignmentData = advisers.value;
      setGradeOptions(batch, assignmentData.batches);
      if (assignmentData.batches.includes(adviserContext.batch)) batch.value = adviserContext.batch;
      const accounts = new Map(assignmentData.accounts.map(({ employeeID, name }) => [employeeID, name]));
      for (const { employeeID } of assignmentData.assignments) {
        if (!accounts.has(employeeID)) accounts.set(employeeID, employeeID + ' (inactive)');
      }
      account.replaceChildren(new Option('No adviser assigned', ''),
        ...Array.from(accounts, ([id, name]) => new Option(`${name} (${id})`, id)));
      displayAssignment();
    } else {
      showAdviserMessage($('assign-feedback'), advisers.reason.message, true);
    }
    batch.disabled = account.disabled = assignments.querySelector('button').disabled = advisers.status !== 'fulfilled';
    assignments.hidden = false;
    if (email.status === 'fulfilled') {
      templateData = email.value;
      displayTemplate();
    } else {
      showAdviserMessage($('template-feedback'), email.reason.message, true);
    }
    for (const control of templates.querySelectorAll('input, select, textarea, button')) {
      control.disabled = email.status !== 'fulfilled';
    }
    templates.hidden = false;
  });
  dismissOnBackdrop(dialog);
  $('close-wat-admin').addEventListener('click', () => dialog.close());
  batch.addEventListener('change', displayAssignment);
  kind.addEventListener('change', displayTemplate);
  assignments.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = assignments.querySelector('button');
    button.disabled = true;
    try {
      assignmentData = await api('adviserAssignments', 'PUT', { batch: batch.value, employeeID: account.value });
      showAdviserMessage($('assign-feedback'), 'Adviser assignment saved.');
    } catch (error) {
      showAdviserMessage($('assign-feedback'), error.message, true);
    } finally {
      button.disabled = false;
    }
  });
  templates.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = templates.querySelector('button');
    button.disabled = true;
    try {
      templateData = await api('emailTemplates', 'PUT', {
        kind: kind.value, subject: $('template-subject').value, body: $('template-body').value,
      });
      showAdviserMessage($('template-feedback'), 'Email template saved.');
    } catch (error) {
      showAdviserMessage($('template-feedback'), error.message, true);
    } finally {
      button.disabled = false;
    }
  });
}
