require('dotenv').config();
const crypto = require('crypto');
const path = require('path');
const { promisify } = require('node:util');
const express = require('express');
const session = require('express-session');
const db = require('./db');

const app = express();
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 8 * 3600 * 1000 },
}));

// ---------- helpers ----------
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const toISO = (d) => d.toISOString().slice(0, 10);
const parse = (s) => new Date(s + 'T00:00:00Z');
function weekStart(s) { // Monday of the week containing s
  const d = parse(s);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return toISO(d);
}
function weekEnd(start) { const d = parse(start); d.setUTCDate(d.getUTCDate() + 6); return toISO(d); }
const today = () => toISO(new Date());
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch((e) => { console.error(e); res.status(500).json({ error: 'Server error' }); });
const validDate = (s) => typeof s === 'string' && DATE_RE.test(s) && !isNaN(parse(s));

// ---------- live updates (SSE) ----------
const clients = new Set();
app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  const hb = setInterval(() => res.write(': hb\n\n'), 25000);
  clients.add(res);
  req.on('close', () => { clearInterval(hb); clients.delete(res); });
});
function broadcast(batch, week) {
  const msg = `data: ${JSON.stringify({ batch, week })}\n\n`;
  for (const c of clients) c.write(msg);
}
const isApproved = async (batch, week) =>
  (await db.query('SELECT 1 FROM wat_week_approvals WHERE batch=? AND week_start=?', [batch, week]))[0].length > 0;

// ---------- student (public, read-only) ----------
app.get('/api/batches', wrap(async (req, res) => {
  const [rows] = await db.query('SELECT DISTINCT batch FROM wat_batch_advisers ORDER BY batch');
  res.json(rows.map((r) => r.batch));
}));

app.get('/api/week', wrap(async (req, res) => {
  const { batch } = req.query;
  const start = weekStart(validDate(req.query.start) ? req.query.start : today());
  if (!batch) return res.status(400).json({ error: 'batch required' });
  const approved = await isApproved(batch, start);
  let items = [];
  if (approved) {
    [items] = await db.query(
      `SELECT a.id, s.name AS subject, a.date_given, a.deadline, a.description
       FROM wat_assessments a JOIN wat_subjects s ON s.id=a.subject_id
       WHERE a.batch=? AND a.deadline BETWEEN ? AND ? ORDER BY a.deadline, s.name`,
      [batch, start, weekEnd(start)]);
  }
  res.json({ start, end: weekEnd(start), approved, items });
}));

// ---------- teacher auth ----------
const adminUsername = 'admin.controller';
const adminSalt = Buffer.from('84a103b787678cb9e9d43c3626cf7f40', 'hex');
const adminPasswordHash = Buffer.from(
  '8255acf73a54ceed9ec082b51fd9f97a137ec0c5737e0a34e207f7bf4c6f8a62b17262ad11668facdef714fbbf07456d5cf52515a30dc58e72fb99d64482bc1b',
  'hex',
);
const scrypt = promisify(crypto.scrypt);

app.post('/api/login', wrap(async (req, res) => {
  const { username, password } = req.body || {};
  const u = String(username || '').trim();
  if (!u && !password) return res.status(400).json({ error: 'Enter your username and password.', fields: { username: 'Username is required', password: 'Password is required' } });
  if (!u) return res.status(400).json({ error: 'Enter your username.', fields: { username: 'Username is required' } });
  if (typeof password !== 'string' || !password) return res.status(400).json({ error: 'Enter your password.', fields: { password: 'Password is required' } });
  if (u.toLowerCase() === adminUsername) {
    const hash = await scrypt(password, adminSalt, adminPasswordHash.length);
    if (!crypto.timingSafeEqual(hash, adminPasswordHash))
      return res.status(401).json({ error: 'Incorrect password.', fields: { password: 'Incorrect password' } });
    await new Promise((resolve, reject) => req.session.regenerate((err) => err ? reject(err) : resolve()));
    req.session.user = { id: adminUsername, name: adminUsername, isAdmin: true };
    return res.json({ ok: true });
  }
  const [rows] = await db.query(
    "SELECT employeeID, username, firstname, lastname, password, status FROM accounts WHERE username=?", [u]);
  // accounts store unsalted MD5 (shared with reserve-a-lab); compare in constant time
  const hash = crypto.createHash('md5').update(password).digest('hex');
  const ok = rows[0] && rows[0].password.length === hash.length &&
    crypto.timingSafeEqual(Buffer.from(rows[0].password), Buffer.from(hash));
  if (!rows[0]) return res.status(401).json({ error: 'No account found with that username.', fields: { username: 'Username not found' } });
  if (!ok) return res.status(401).json({ error: 'Incorrect password.', fields: { password: 'Incorrect password' } });
  if (rows[0].status !== 'active') return res.status(403).json({ error: 'This account is inactive. Contact the administrator.', fields: { username: 'Account inactive' } });
  await new Promise((r) => req.session.regenerate(r));
  req.session.user = { id: rows[0].employeeID, name: `${rows[0].firstname} ${rows[0].lastname}` };
  res.json({ ok: true });
}));
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

async function me(req) {
  const u = req.session.user;
  if (!u) return null;
  if (u.isAdmin) return { ...u, adviserOf: [] };
  const [r] = await db.query('SELECT batch FROM wat_batch_advisers WHERE employeeID=?', [u.id]);
  return { ...u, adviserOf: r.map((x) => x.batch) };
}
const needUser = wrap(async (req, res, next) => {
  req.me = await me(req);
  if (!req.me) return res.status(401).json({ error: 'Login required' });
  next();
});
const guard = (fn) => [needUser, wrap(fn)];
app.get('/api/me', wrap(async (req, res) => res.json({ user: await me(req) })));

const canEditAll = (u, batch) => u.isAdmin || u.adviserOf.includes(batch);

// ---------- teacher API ----------
app.get('/api/subjects', guard(async (req, res) => {
  const [rows] = await db.query('SELECT id, name FROM wat_subjects ORDER BY name');
  res.json(rows);
}));
app.post('/api/subjects', guard(async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 100);
  if (!name) return res.status(400).json({ error: 'Name required' });
  await db.query('INSERT IGNORE INTO wat_subjects (name) VALUES (?)', [name]);
  const [r] = await db.query('SELECT id, name FROM wat_subjects WHERE name=?', [name]);
  res.json(r[0]);
}));

app.get('/api/teacher/week', guard(async (req, res) => {
  const { batch } = req.query;
  const start = weekStart(validDate(req.query.start) ? req.query.start : today());
  if (!batch) return res.status(400).json({ error: 'batch required' });
  const all = canEditAll(req.me, batch);
  const params = [batch, start, weekEnd(start)];
  let sql = `SELECT a.id, a.subject_id, s.name AS subject, a.date_given, a.deadline, a.description,
                    a.teacher_id, a.assessment_type, a.topic, a.implementation, a.remarks
             FROM wat_assessments a JOIN wat_subjects s ON s.id=a.subject_id
             WHERE a.batch=? AND a.deadline BETWEEN ? AND ?`;
  if (!all) { sql += ' AND a.teacher_id=?'; params.push(req.me.id); }
  const [items] = await db.query(sql + ' ORDER BY a.deadline, s.name', params);
  // names looked up separately: accounts (latin1) and WAT tables (utf8mb4) can't be joined on collation
  const ids = [...new Set(items.map((i) => i.teacher_id))];
  if (ids.length) {
    const [t] = await db.query('SELECT employeeID, firstname, lastname FROM accounts WHERE employeeID IN (?)', [ids]);
    const names = Object.fromEntries(t.map((x) => [x.employeeID, `${x.firstname} ${x.lastname}`]));
    items.forEach((i) => { i.teacher = i.teacher_id === adminUsername ? adminUsername : names[i.teacher_id] || ''; });
  }
  res.json({ start, end: weekEnd(start), approved: await isApproved(batch, start), isAdviser: all, items });
}));

function readEntry(b) {
  const e = {
    batch: String(b.batch || '').trim(),
    subject_id: parseInt(b.subject_id, 10),
    date_given: b.date_given,
    deadline: b.deadline,
    description: String(b.description || '').trim(),
    assessment_type: b.assessment_type || null,
    topic: String(b.topic || '').trim() || null,
    implementation: b.implementation || null,
    remarks: String(b.remarks || '').trim() || null,
  };
  if (!e.batch || !e.subject_id || !validDate(e.date_given) || !validDate(e.deadline) || !e.description) return null;
  if (e.deadline < e.date_given) return null;
  if (e.assessment_type && !['formative', 'summative', 'alternative'].includes(e.assessment_type)) return null;
  if (e.implementation && !['sync', 'async'].includes(e.implementation)) return null;
  if (e.topic?.length > 255 || e.remarks?.length > 4000) return null;
  return e;
}
async function batchExists(batch) {
  return (await db.query('SELECT 1 FROM wat_batch_advisers WHERE batch=? LIMIT 1', [batch]))[0].length > 0;
}

app.post('/api/teacher/assessments', guard(async (req, res) => {
  const e = readEntry(req.body);
  if (!e) return res.status(400).json({ error: 'Invalid entry (check fields; deadline cannot precede date given)' });
  if (!(await batchExists(e.batch))) return res.status(400).json({ error: 'Unknown batch' });
  const [r] = await db.query(
    `INSERT INTO wat_assessments
       (batch, subject_id, teacher_id, date_given, deadline, description, assessment_type, topic, implementation, remarks)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [e.batch, e.subject_id, req.me.id, e.date_given, e.deadline, e.description, e.assessment_type, e.topic, e.implementation, e.remarks]);
  broadcast(e.batch, weekStart(e.deadline));
  res.json({ id: r.insertId });
}));

async function ownedEntry(req, res) {
  const [r] = await db.query('SELECT * FROM wat_assessments WHERE id=?', [req.params.id]);
  const a = r[0];
  if (!a) { res.status(404).json({ error: 'Not found' }); return null; }
  if (a.teacher_id !== req.me.id && !canEditAll(req.me, a.batch)) {
    res.status(403).json({ error: 'You can only edit your own entries' }); return null;
  }
  return a;
}

app.put('/api/teacher/assessments/:id', guard(async (req, res) => {
  const old = await ownedEntry(req, res); if (!old) return;
  const e = readEntry({ ...old, ...req.body, batch: old.batch }); // batch is fixed
  if (!e) return res.status(400).json({ error: 'Invalid entry' });
  await db.query(
    `UPDATE wat_assessments SET subject_id=?, date_given=?, deadline=?, description=?,
       assessment_type=?, topic=?, implementation=?, remarks=? WHERE id=?`,
    [e.subject_id, e.date_given, e.deadline, e.description, e.assessment_type, e.topic, e.implementation, e.remarks, old.id]);
  broadcast(old.batch, weekStart(old.deadline));
  broadcast(old.batch, weekStart(e.deadline)); // covers a move to another week
  res.json({ ok: true });
}));

app.delete('/api/teacher/assessments/:id', guard(async (req, res) => {
  const old = await ownedEntry(req, res); if (!old) return;
  await db.query('DELETE FROM wat_assessments WHERE id=?', [old.id]);
  broadcast(old.batch, weekStart(old.deadline));
  res.json({ ok: true });
}));

app.post('/api/teacher/approve', guard(async (req, res) => {
  const { batch, approved } = req.body;
  if (!validDate(req.body.start) || !canEditAll(req.me, batch))
    return res.status(403).json({ error: 'Only the batch adviser can approve' });
  const start = weekStart(req.body.start);
  if (approved) {
    await db.query('INSERT IGNORE INTO wat_week_approvals (batch, week_start, approved_by) VALUES (?,?,?)',
      [batch, start, req.me.id]);
  } else {
    await db.query('DELETE FROM wat_week_approvals WHERE batch=? AND week_start=?', [batch, start]);
  }
  broadcast(batch, start);
  res.json({ ok: true });
}));

app.get('/', (req, res) => res.redirect(`public/${req.url.slice(1)}`));

const servePublic = express.static(path.join(__dirname, '..', 'public'));
app.use('/public', servePublic);
app.use(servePublic);
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`WAT running on http://localhost:${port}`));
