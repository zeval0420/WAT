// shared date helpers (all dates are 'YYYY-MM-DD' strings; weeks start Monday)
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); };
const mondayOf = (s) => { const d = new Date(s + 'T00:00:00'); return addDays(s, -((d.getDay() + 6) % 7)); };
const fmt = (s) => new Date(s + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const rangeLabel = (a, b) => `${fmt(a)} – ${fmt(b)}`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (id) => document.getElementById(id);
const pageDirectory = new URL('.', window.location.href);
const appDirectory = pageDirectory.pathname.endsWith('/public/')
  ? new URL('..', pageDirectory)
  : pageDirectory;
const apiUrl = (path) => new URL(path.replace(/^\//, ''), appDirectory);
async function api(url, method = 'GET', body) {
  let r;
  try { r = await fetch(apiUrl(url), { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body && JSON.stringify(body) }); }
  catch { throw Object.assign(new Error('Cannot reach the server. Check your connection and try again.'), { status: 0 }); }
  const j = await r.json().catch(() => null);
  if (!r.ok) throw Object.assign(new Error((j && j.error) || `Unexpected server response (${r.status}). The server may need a restart.`), { status: r.status, fields: j && j.fields });
  if (j === null) throw Object.assign(new Error('Unexpected server response. The server may need a restart.'), { status: r.status });
  return j;
}
function onLive(handler) { // reconnecting SSE
  const es = new EventSource(apiUrl('/api/events'));
  es.onmessage = (e) => handler(JSON.parse(e.data));
  return es;
}
