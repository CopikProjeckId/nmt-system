/**
 * Sync module - State synchronization infrastructure
 * @module sync
 */

export {
  VectorClock,
  createVectorClock,
  type ClockComparison,
  type SerializedClock,
} from './vector-clock.js';

export {
  ChangeJournal,
  createChangeJournal,
  type ChangeEntry,
  type ChangeInput,
  type ChangeEntityType,
  type ChangeOperation,
  type JournalStats,
} from './change-journal.js';

export {
  StateSyncManager,
  createStateSyncManager,
  type SyncPeer,
  type SyncState,
  type ConflictStrategy,
  type ConflictResolution,
  type StateDiffResult,
  type ApplyResult,
  type StateSyncOptions,
} from './state-sync.js';
