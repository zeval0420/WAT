const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');

const credentialsPath = path.resolve(__dirname, '../../credentials/db_connection.php');
const credentials = fs.readFileSync(credentialsPath, 'utf8');

// Read the shared PHP file's quoted assignments without running its mysqli connection.
function credential(name) {
  const assignment = new RegExp(
    String.raw`^[ \t]*\$${name}\s*=\s*(?:'((?:\\.|[^'\\\r\n])*)'|"((?:\\.|[^"\\\r\n])*)")\s*;`, 'm'
  ).exec(credentials);
  if (!assignment) throw new Error('Missing literal $' + name + ' in ' + credentialsPath);
  if (assignment[1] !== undefined) return assignment[1].replace(/\\(['\\])/g, '$1');
  // Reject PHP expressions and special escapes rather than using a different password.
  if (/(?:^|[^\\])(?:\\\\)*(?:\$[a-zA-Z_{\x80-\uFFFF]|\\[nrtvefx0-7u])/.test(assignment[2])) {
    throw new Error('Expected a plain string for $' + name + ' in ' + credentialsPath);
  }
  return assignment[2].replace(/\\(["\\$])/g, '$1');
}

module.exports = mysql.createPool({
  host: credential('servername'),
  user: credential('username'),
  password: credential('password'),
  database: credential('database'),
  dateStrings: true, // keep DATE columns as 'YYYY-MM-DD'
  multipleStatements: true,
  connectionLimit: 10,
});
