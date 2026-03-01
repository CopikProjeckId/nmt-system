/**
 * SQLite shared connection — WAL mode, per-process singleton per dataDir.
 *
 * WAL(Write-Ahead Logging)이 LevelDB의 단일 프로세스 잠금 문제를 해결:
 *   - 동일 프로세스 내: 연결 공유
 *   - 별도 프로세스(Dashboard + MCP + CLI): 각자 연결, SQLite가 WAL로 직렬화
 *   - 읽기는 쓰기를 블록하지 않음
 *
 * @module storage/db
 */

import Database from 'better-sqlite3';
import * as path from 'path';

/** dataDir → Database 인스턴스 캐시 (프로세스 내 공유) */
const _cache = new Map<string, Database.Database>();

/**
 * 주어진 dataDir의 SQLite 연결을 반환한다.
 * 처음 호출 시 WAL 모드로 열고 스키마를 생성한다.
 */
export function openDb(dataDir: string): Database.Database {
  const key = path.resolve(dataDir);
  if (_cache.has(key)) return _cache.get(key)!;

  const db = new Database(path.join(key, 'nmt.db'));

  // WAL 설정: 읽기/쓰기 동시성 + 크래시 안전성
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');   // WAL에서 NORMAL = 안전 + 빠름
  db.pragma('cache_size = -32000');    // 32MB 페이지 캐시
  db.pragma('foreign_keys = ON');
  db.pragma('temp_store = MEMORY');

  // 전체 스키마 생성 (idempotent)
  db.exec(`
    -- ── Neurons ─────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS neurons (
      id          TEXT PRIMARY KEY,
      merkle_root TEXT NOT NULL,
      chunk_hashes TEXT NOT NULL,     -- JSON: SHA3Hash[]
      embedding   BLOB NOT NULL,      -- Float32Array (1536 bytes = 384 * 4)
      metadata    TEXT NOT NULL,      -- JSON: NeuronMetadata
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_neurons_root ON neurons(merkle_root);

    -- ── Synapses ─────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS synapses (
      id                  TEXT PRIMARY KEY,
      source_id           TEXT NOT NULL,
      target_id           TEXT NOT NULL,
      type                TEXT NOT NULL,
      weight              REAL NOT NULL DEFAULT 1.0,
      co_activation_count INTEGER NOT NULL DEFAULT 0,
      metadata            TEXT NOT NULL,   -- JSON: SynapseMetadata
      created_at          TEXT NOT NULL,
      updated_at          TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_syn_source ON synapses(source_id);
    CREATE INDEX IF NOT EXISTS idx_syn_target ON synapses(target_id);

    -- ── Chunk Metadata ───────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS chunk_metadata (
      hash        TEXT PRIMARY KEY,
      size        INTEGER NOT NULL,
      chunk_index INTEGER NOT NULL,
      offset      INTEGER NOT NULL,
      fingerprint INTEGER,
      ref_count   INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL
    );

    -- ── HNSW Index Serialization ─────────────────────────────────
    CREATE TABLE IF NOT EXISTS hnsw_indices (
      name       TEXT PRIMARY KEY,
      data       BLOB NOT NULL,      -- JSON-serialized HNSWIndex
      node_count INTEGER NOT NULL,
      params     TEXT NOT NULL,      -- JSON: HNSWParams
      saved_at   TEXT NOT NULL
    );

    -- ── Change Journal (Sync) ────────────────────────────────────
    CREATE TABLE IF NOT EXISTS journal (
      sequence  INTEGER PRIMARY KEY,
      entry     TEXT NOT NULL        -- JSON: ChangeEntry
    );

    -- ── Probabilistic State ──────────────────────────────────────
    CREATE TABLE IF NOT EXISTS probabilistic (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  _cache.set(key, db);
  return db;
}

/**
 * dataDir의 SQLite 연결을 닫고 캐시에서 제거한다.
 */
export function closeDb(dataDir: string): void {
  const key = path.resolve(dataDir);
  const db = _cache.get(key);
  if (db) {
    db.close();
    _cache.delete(key);
  }
}
