const { spawnSync } = require('node:child_process');
const path = require('node:path');
const mysql = require('mysql2/promise');

const helper = path.join(__dirname, 'db-config.php');
const { error, status, stdout } = spawnSync('php', [helper], { encoding: 'utf8' });
if (error) throw error;
if (status !== 0 || !stdout) {
  throw new Error('Could not load the shared database connection. Check PHP CLI, mysqli, and credentials/db_connection.php.');
}

module.exports = mysql.createPool({
  ...JSON.parse(stdout),
  dateStrings: true, // keep DATE columns as 'YYYY-MM-DD'
  multipleStatements: true,
  connectionLimit: 10,
});
