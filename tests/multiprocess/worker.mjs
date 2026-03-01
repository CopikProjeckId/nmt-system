/**
 * Multiprocess worker — opens the same SQLite DB and does concurrent reads/writes.
 * Spawned by multiprocess-test.mjs.
 *
 * Usage: node worker.mjs <dataDir> <workerId> <ops>
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const [,, dataDir, workerId, opsStr] = process.argv;
const OPS = parseInt(opsStr ?? '20', 10);

function log(msg) {
  process.stdout.write(`[worker-${workerId}] ${msg}\n`);
}

try {
  const dbPath = path.join(dataDir, 'nmt.db');
  const db = new Database(dbPath);

  // 동일한 WAL 설정
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000'); // 5초 대기 후 BUSY 에러

  // 테이블 보장 (이미 있으면 무시)
  db.exec(`
    CREATE TABLE IF NOT EXISTS mp_test (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      worker  TEXT NOT NULL,
      seq     INTEGER NOT NULL,
      value   TEXT NOT NULL,
      ts      TEXT NOT NULL
    )
  `);

  const insert = db.prepare(
    'INSERT INTO mp_test (worker, seq, value, ts) VALUES (?, ?, ?, ?)'
  );
  const selectAll = db.prepare(
    'SELECT COUNT(*) as cnt FROM mp_test'
  );

  let writeOk = 0;
  let readOk  = 0;
  const errors = [];

  // 쓰기 + 읽기를 OPS 번 반복
  for (let i = 0; i < OPS; i++) {
    try {
      insert.run(`worker-${workerId}`, i, `payload-${workerId}-${i}`, new Date().toISOString());
      writeOk++;
    } catch (e) {
      errors.push(`write[${i}]: ${e.message}`);
    }

    try {
      const row = selectAll.get();
      if (row && row.cnt >= 0) readOk++;
    } catch (e) {
      errors.push(`read[${i}]: ${e.message}`);
    }
  }

  db.close();

  const result = { workerId, writeOk, readOk, errors, ops: OPS };
  log(`done — writes=${writeOk}/${OPS} reads=${readOk}/${OPS} errors=${errors.length}`);
  if (errors.length > 0) log(`ERRORS: ${errors.slice(0, 3).join(', ')}`);

  // 부모 프로세스에 결과 전달
  process.send?.(result);
  process.exit(errors.length > 0 ? 1 : 0);

} catch (fatal) {
  process.stdout.write(`[worker-${workerId}] FATAL: ${fatal.message}\n`);
  process.send?.({ workerId, fatal: fatal.message });
  process.exit(2);
}
