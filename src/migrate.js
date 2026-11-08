// Applies every sql/*.sql file in name order. Files are idempotent.
const fs = require('fs');
const path = require('path');
const db = require('./db');

(async () => {
  const dir = path.join(__dirname, '..', 'sql');
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    await db.query(fs.readFileSync(path.join(dir, f), 'utf8'));
    console.log('applied', f);
  }
  await db.end();
})().catch((e) => { console.error(e); process.exit(1); });
