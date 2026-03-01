/**
 * SQLite WAL 멀티 프로세스 동시 접근 테스트
 *
 * N개 프로세스를 동시에 실행해 동일한 SQLite DB에 읽기/쓰기를 수행한다.
 * LevelDB였으면 LOCK 에러가 발생할 상황. SQLite WAL이면 모두 성공해야 한다.
 *
 * Usage: node multiprocess-test.mjs [workers=5] [ops=30]
 */

import { fork } from 'child_process';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));

const WORKERS   = parseInt(process.argv[2] ?? '5',  10);
const OPS       = parseInt(process.argv[3] ?? '30', 10);
const DATA_DIR  = resolve(os.tmpdir(), `nmt-mp-test-${Date.now()}`);
const WORKER_JS = resolve(__dirname, 'worker.mjs');

// ── 색상 출력 ────────────────────────────────────────────────────────────────
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';

function ok(msg)   { console.log(`${GREEN}✓${RESET} ${msg}`); }
function fail(msg) { console.log(`${RED}✗${RESET} ${msg}`); }
function info(msg) { console.log(`${CYAN}ℹ${RESET} ${msg}`); }
function warn(msg) { console.log(`${YELLOW}⚠${RESET} ${msg}`); }

// ── 테스트 DB 초기화 ──────────────────────────────────────────────────────────
function initDb(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(resolve(dataDir, 'nmt.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  // NMT 스키마 + 테스트 테이블 생성
  db.exec(`
    CREATE TABLE IF NOT EXISTS neurons (
      id TEXT PRIMARY KEY, merkle_root TEXT NOT NULL,
      chunk_hashes TEXT NOT NULL, embedding BLOB NOT NULL,
      metadata TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS synapses (
      id TEXT PRIMARY KEY, source_id TEXT NOT NULL, target_id TEXT NOT NULL,
      type TEXT NOT NULL, weight REAL NOT NULL DEFAULT 1.0,
      co_activation_count INTEGER NOT NULL DEFAULT 0,
      metadata TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chunk_metadata (
      hash TEXT PRIMARY KEY, size INTEGER NOT NULL,
      chunk_index INTEGER NOT NULL, offset INTEGER NOT NULL,
      fingerprint INTEGER, ref_count INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS hnsw_indices (
      name TEXT PRIMARY KEY, data BLOB NOT NULL,
      node_count INTEGER NOT NULL, params TEXT NOT NULL, saved_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS journal (
      sequence INTEGER PRIMARY KEY, entry TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS probabilistic (
      key TEXT PRIMARY KEY, value TEXT NOT NULL
    );
  `);
  db.close();
}

// ── 워커 실행 ─────────────────────────────────────────────────────────────────
function runWorker(id) {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = fork(WORKER_JS, [DATA_DIR, String(id), String(OPS)], {
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    });

    let result = null;

    child.on('message', (msg) => { result = msg; });

    child.on('exit', (code) => {
      const elapsed = Date.now() - start;
      resolve({ id, code, elapsed, result });
    });

    child.on('error', (err) => {
      resolve({ id, code: -1, elapsed: Date.now() - start, error: err.message });
    });
  });
}

// ── 메인 ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${BOLD}══ SQLite WAL 멀티 프로세스 동시 접근 테스트 ══${RESET}`);
  info(`Workers: ${WORKERS}  Ops/worker: ${OPS}  Total ops: ${WORKERS * OPS * 2} (read+write)`);
  info(`DB: ${DATA_DIR}/nmt.db\n`);

  // 1. DB 초기화 (메인 프로세스)
  initDb(DATA_DIR);
  ok('DB initialized (WAL mode)');

  // 2. 메인 프로세스도 동시에 DB에 쓰기
  const mainDb = new Database(resolve(DATA_DIR, 'nmt.db'));
  mainDb.pragma('journal_mode = WAL');
  mainDb.pragma('busy_timeout = 5000');
  mainDb.exec(`CREATE TABLE IF NOT EXISTS mp_test (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    worker TEXT NOT NULL, seq INTEGER NOT NULL,
    value TEXT NOT NULL, ts TEXT NOT NULL
  )`);

  // 3. N개 워커 동시 실행
  info(`Spawning ${WORKERS} workers simultaneously...`);
  const t0 = Date.now();
  const promises = Array.from({ length: WORKERS }, (_, i) => runWorker(i + 1));

  // 메인 프로세스도 동시에 쓰기
  const mainInsert = mainDb.prepare(
    'INSERT INTO mp_test (worker, seq, value, ts) VALUES (?, ?, ?, ?)'
  );
  const mainSelect = mainDb.prepare('SELECT COUNT(*) as cnt FROM mp_test');
  let mainWrites = 0;
  let mainReads  = 0;
  let mainErrors = 0;
  for (let i = 0; i < OPS; i++) {
    try { mainInsert.run('main', i, `main-payload-${i}`, new Date().toISOString()); mainWrites++; }
    catch { mainErrors++; }
    try { mainSelect.get(); mainReads++; }
    catch { mainErrors++; }
  }
  mainDb.close();
  info(`Main process: writes=${mainWrites}/${OPS} reads=${mainReads}/${OPS} errors=${mainErrors}`);

  // 4. 모든 워커 완료 대기
  const results = await Promise.all(promises);
  const elapsed = Date.now() - t0;

  // 5. 결과 분석
  console.log(`\n${BOLD}── 결과 ──────────────────────────────────${RESET}`);
  let allOk = true;
  let totalWrites = mainWrites;
  let totalReads  = mainReads;
  let totalErrors = mainErrors;

  for (const r of results) {
    const w = r.result;
    if (r.code === 0 && w) {
      ok(`Worker-${r.id}: writes=${w.writeOk}/${OPS} reads=${w.readOk}/${OPS} errors=${w.errors.length} (${r.elapsed}ms)`);
      totalWrites += w.writeOk;
      totalReads  += w.readOk;
      totalErrors += w.errors.length;
      if (w.errors.length > 0) {
        allOk = false;
        for (const e of w.errors.slice(0, 3)) warn(`  ${e}`);
      }
    } else {
      fail(`Worker-${r.id}: exit=${r.code} ${r.error ?? r.result?.fatal ?? ''} (${r.elapsed}ms)`);
      allOk = false;
      totalErrors++;
    }
  }

  // 6. 최종 DB 검증 (메인이 모두 닫힌 후)
  console.log();
  try {
    const verifyDb = new Database(resolve(DATA_DIR, 'nmt.db'));
    verifyDb.pragma('journal_mode = WAL');
    const count = (verifyDb.prepare('SELECT COUNT(*) as cnt FROM mp_test').get()).cnt;
    verifyDb.close();
    info(`DB row count: ${count} (expected ≈ ${(WORKERS + 1) * OPS})`);
    const expected = (WORKERS + 1) * OPS;
    if (count >= expected * 0.95) {
      ok(`Row count ${count} ≥ 95% of expected ${expected} ✓`);
    } else {
      fail(`Row count ${count} < 95% of expected ${expected} — data loss!`);
      allOk = false;
    }
  } catch (e) {
    fail(`DB verification failed: ${e.message}`);
    allOk = false;
  }

  // 7. 요약
  console.log(`\n${BOLD}── 요약 ──────────────────────────────────${RESET}`);
  info(`총 쓰기: ${totalWrites}  총 읽기: ${totalReads}  총 에러: ${totalErrors}`);
  info(`소요시간: ${elapsed}ms (전체 동시 실행)`);

  if (mainErrors > 0) { fail(`메인 프로세스 에러: ${mainErrors}개`); allOk = false; }

  if (allOk && totalErrors === 0) {
    console.log(`\n${BOLD}${GREEN}✓ PASS — 멀티 프로세스 동시 접근 성공 (LOCK 에러 없음)${RESET}\n`);
  } else {
    console.log(`\n${BOLD}${RED}✗ FAIL — 에러 발생 (총 ${totalErrors}개)${RESET}\n`);
  }

  // 8. 정리
  try { rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* ignore */ }

  process.exit(allOk && totalErrors === 0 ? 0 : 1);
}

main().catch(e => {
  console.error('Fatal:', e);
  try { rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(2);
});
