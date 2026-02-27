/**
 * State Sync Manager - Distributed state synchronization
 *
 * Manages state synchronization between nodes using vector clocks
 * for causality tracking and conflict resolution.
 *
 * @module sync/state-sync
 */

import type { MerkleRoot } from '../types/index.js';
import type { MerkleEngine, TreeDiff } from '../core/merkle-engine.js';
import type { EventBus } from '../events/event-bus.js';
import { createEvent } from '../events/event-bus.js';
import { VectorClock, type SerializedClock } from './vector-clock.js';
import {
  ChangeJournal,
  type ChangeEntry,
  type ChangeInput,
  type ChangeEntityType,
  type ChangeOperation,
} from './change-journal.js';

/**
 * Remote peer information
 */
export interface SyncPeer {
  /** Unique peer identifier */
  peerId: string;
  /** Network endpoint (URL or address) */
  endpoint: string;
  /** Last seen timestamp */
  lastSeen: number;
  /** Last known sequence number */
  lastSequence: number;
  /** Last known vector clock */
  vectorClock: SerializedClock;
  /** Connection status */
  status: 'connected' | 'disconnected' | 'unknown';
}

/**
 * Local sync state
 */
export interface SyncState {
  /** This node's ID */
  nodeId: string;
  /** Current Merkle root (state hash) */
  merkleRoot: MerkleRoot | null;
  /** Current vector clock */
  vectorClock: VectorClock;
  /** Current sequence number */
  sequence: number;
  /** Last sync timestamp */
  lastSync: string | null;
}

/**
 * Conflict resolution strategies
 */
export type ConflictStrategy = 'last-write-wins' | 'vector-clock' | 'merge' | 'manual';

/**
 * Conflict resolution configuration
 */
export interface ConflictResolution {
  /** Resolution strategy */
  strategy: ConflictStrategy;
  /** Custom resolver for 'merge' or 'manual' strategies */
  resolver?: (local: ChangeEntry, remote: ChangeEntry) => ChangeEntry | null;
}

/**
 * Result of state diff computation
 */
export interface StateDiffResult {
  /** Whether sync is needed */
  needsSync: boolean;
  /** Entries local has that remote doesn't */
  localAhead: ChangeEntry[];
  /** Sequences remote has that local needs */
  remoteAhead: number[];
  /** Detected conflicts */
  conflicts: Array<{
    local: ChangeEntry;
    remote: ChangeEntry;
  }>;
}

/**
 * Result of applying remote changes
 */
export interface ApplyResult {
  /** Number of changes successfully applied */
  applied: number;
  /** Number of conflicts encountered */
  conflicts: number;
  /** Resolved conflict entries */
  resolved: ChangeEntry[];
  /** Skipped entries (already applied) */
  skipped: number;
}

/**
 * StateSyncManager options
 */
export interface StateSyncOptions {
  /** This node's ID */
  nodeId: string;
  /** Change journal for persistence */
  journal: ChangeJournal;
  /** Merkle engine for state hashing */
  merkleEngine: MerkleEngine;
  /** Event bus for notifications */
  eventBus?: EventBus;
  /** Conflict resolution configuration */
  conflictResolution?: ConflictResolution;
}

/**
 * StateSyncManager - Coordinates state synchronization
 *
 * Features:
 * - Vector clock-based causality tracking
 * - Change journal for durability
 * - Configurable conflict resolution
 * - Event-based notifications
 *
 * @example
 * ```typescript
 * const sync = new StateSyncManager({
 *   nodeId: 'node-1',
 *   journal: changeJournal,
 *   merkleEngine: merkleEngine,
 *   eventBus: eventBus
 * });
 *
 * await sync.init();
 *
 * // Record local changes
 * await sync.recordChange({
 *   type: 'neuron',
 *   operation: 'create',
 *   entityId: 'neuron-123',
 *   data: { content: 'Hello' }
 * });
 *
 * // Compute diff with remote
 * const diff = await sync.computeStateDiff(remoteState);
 *
 * // Apply remote changes
 * const result = await sync.applyRemoteChanges(remoteChanges);
 * ```
 */
export class StateSyncManager {
  private nodeId: string;
  private journal: ChangeJournal;
  private merkleEngine: MerkleEngine;
  private eventBus: EventBus | null;
  private conflictResolution: ConflictResolution;

  private vectorClock: VectorClock;
  private merkleRoot: MerkleRoot | null = null;
  private lastKnownSequence: number = 0;
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;
  private peers: Map<string, SyncPeer> = new Map();
  private conflictHandlers: Array<(local: ChangeEntry, remote: ChangeEntry) => void> = [];

  constructor(options: StateSyncOptions) {
    this.nodeId = options.nodeId;
    this.journal = options.journal;
    this.merkleEngine = options.merkleEngine;
    this.eventBus = options.eventBus ?? null;
    this.conflictResolution = options.conflictResolution ?? {
      strategy: 'last-write-wins',
    };

    this.vectorClock = new VectorClock(this.nodeId);
  }

  /**
   * Initialize the sync manager
   * Thread-safe: concurrent calls will wait for the same initialization
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    // If initialization is already in progress, wait for it
    if (this.initPromise) {
      return this.initPromise;
    }

    // Start initialization
    this.initPromise = this._doInit();
    await this.initPromise;
  }

  /**
   * Internal initialization logic
   */
  private async _doInit(): Promise<void> {
    try {
      await this.journal.init();

      // Restore vector clock and sequence from journal
      const latestSeq = await this.journal.getLatestSequence();
      this.lastKnownSequence = latestSeq;
      if (latestSeq > 0) {
        const latestEntry = await this.journal.get(latestSeq);
        if (latestEntry) {
          this.vectorClock = VectorClock.fromJSON(
            latestEntry.vectorClock,
            this.nodeId
          );
        }
      }

      this.initialized = true;
    } catch (error) {
      // Reset promise so init can be retried
      this.initPromise = null;
      throw error;
    }
  }

  /**
   * Record a local change
   */
  async recordChange(change: {
    type: ChangeEntityType;
    operation: ChangeOperation;
    entityId: string;
    data: unknown;
    metadata?: Record<string, unknown>;
  }): Promise<number> {
    if (!this.initialized) {
      await this.init();
    }

    // Increment vector clock
    this.vectorClock.tick(this.nodeId);

    const entry: ChangeInput = {
      type: change.type,
      operation: change.operation,
      entityId: change.entityId,
      data: change.data,
      vectorClock: this.vectorClock.toJSON(),
      timestamp: new Date().toISOString(),
      nodeId: this.nodeId,
      metadata: change.metadata,
    };

    const sequence = await this.journal.append(entry);
    this.lastKnownSequence = sequence;

    // Emit event
    if (this.eventBus) {
      this.eventBus.publish(createEvent(
        'sync:state_changed',
        'state-sync',
        { sequence, entry }
      ));
    }

    return sequence;
  }

  /**
   * Record multiple changes atomically
   */
  async recordChanges(changes: Array<{
    type: ChangeEntityType;
    operation: ChangeOperation;
    entityId: string;
    data: unknown;
    metadata?: Record<string, unknown>;
  }>): Promise<number[]> {
    if (!this.initialized) {
      await this.init();
    }

    const entries: ChangeInput[] = [];

    for (const change of changes) {
      this.vectorClock.tick(this.nodeId);

      entries.push({
        type: change.type,
        operation: change.operation,
        entityId: change.entityId,
        data: change.data,
        vectorClock: this.vectorClock.toJSON(),
        timestamp: new Date().toISOString(),
        nodeId: this.nodeId,
        metadata: change.metadata,
      });
    }

    return this.journal.appendBatch(entries);
  }

  /**
   * Compute diff between local and remote state
   */
  async computeStateDiff(remoteState: SyncState): Promise<StateDiffResult> {
    const localSequence = await this.journal.getLatestSequence();

    const result: StateDiffResult = {
      needsSync: false,
      localAhead: [],
      remoteAhead: [],
      conflicts: [],
    };

    // Compare vector clocks
    const comparison = this.vectorClock.compare(remoteState.vectorClock);

    switch (comparison) {
      case 'equal':
        // States are in sync
        return result;

      case 'after':
        // Local is ahead - send local changes
        result.needsSync = true;
        if (remoteState.sequence < localSequence) {
          result.localAhead = await this.journal.getAfterSequence(remoteState.sequence);
        }
        break;

      case 'before':
        // Remote is ahead - request remote changes
        result.needsSync = true;
        for (let seq = localSequence + 1; seq <= remoteState.sequence; seq++) {
          result.remoteAhead.push(seq);
        }
        break;

      case 'concurrent':
        // Concurrent changes - potential conflicts
        result.needsSync = true;
        if (remoteState.sequence < localSequence) {
          result.localAhead = await this.journal.getAfterSequence(remoteState.sequence);
        }
        for (let seq = localSequence + 1; seq <= remoteState.sequence; seq++) {
          result.remoteAhead.push(seq);
        }
        break;
    }

    return result;
  }

  /**
   * Apply remote changes
   */
  async applyRemoteChanges(changes: ChangeEntry[]): Promise<ApplyResult> {
    const result: ApplyResult = {
      applied: 0,
      conflicts: 0,
      resolved: [],
      skipped: 0,
    };

    for (const remoteEntry of changes) {
      // Check for conflicts
      const localEntries = await this.journal.getByEntity(remoteEntry.entityId);
      const conflictingEntry = localEntries.find(local => {
        const localClock = VectorClock.fromJSON(local.vectorClock);
        const remoteClock = VectorClock.fromJSON(remoteEntry.vectorClock);
        return localClock.isConcurrentWith(remoteClock);
      });

      if (conflictingEntry) {
        result.conflicts++;

        // Emit conflict event
        if (this.eventBus) {
          this.eventBus.publish(createEvent(
            'sync:conflict',
            'state-sync',
            { local: conflictingEntry, remote: remoteEntry }
          ));
        }

        // Notify handlers
        for (const handler of this.conflictHandlers) {
          handler(conflictingEntry, remoteEntry);
        }

        // Resolve conflict
        const resolved = this.resolveConflict(conflictingEntry, remoteEntry);

        if (resolved) {
          // Apply resolved change
          await this.recordChange({
            type: resolved.type,
            operation: resolved.operation,
            entityId: resolved.entityId,
            data: resolved.data,
            metadata: { resolvedConflict: true },
          });

          result.resolved.push(resolved);

          if (this.eventBus) {
            this.eventBus.publish(createEvent(
              'sync:resolved',
              'state-sync',
              { resolved }
            ));
          }
        }
      } else {
        // No conflict - apply directly
        // Merge vector clocks
        const remoteClock = VectorClock.fromJSON(remoteEntry.vectorClock);
        this.vectorClock.update(remoteClock);

        // Record in local journal
        await this.journal.append({
          type: remoteEntry.type,
          operation: remoteEntry.operation,
          entityId: remoteEntry.entityId,
          data: remoteEntry.data,
          vectorClock: this.vectorClock.toJSON(),
          timestamp: new Date().toISOString(),
          nodeId: remoteEntry.nodeId,
          metadata: { ...remoteEntry.metadata, synced: true },
        });

        result.applied++;
      }
    }

    return result;
  }

  /**
   * Get current local state
   */
  /**
   * @deprecated Use getLocalStateAsync() for accurate sequence number.
   * This synchronous version returns the last known sequence from memory.
   */
  getLocalState(): SyncState {
    return {
      nodeId: this.nodeId,
      merkleRoot: this.merkleRoot,
      vectorClock: this.vectorClock.clone(),
      sequence: this.lastKnownSequence,
      lastSync: null,
    };
  }

  /**
   * Get local state with current sequence
   */
  async getLocalStateAsync(): Promise<SyncState> {
    const sequence = await this.journal.getLatestSequence();
    return {
      nodeId: this.nodeId,
      merkleRoot: this.merkleRoot,
      vectorClock: this.vectorClock.clone(),
      sequence,
      lastSync: new Date().toISOString(),
    };
  }

  /**
   * Register conflict handler
   */
  onConflict(handler: (local: ChangeEntry, remote: ChangeEntry) => void): () => void {
    this.conflictHandlers.push(handler);
    return () => {
      const index = this.conflictHandlers.indexOf(handler);
      if (index >= 0) {
        this.conflictHandlers.splice(index, 1);
      }
    };
  }

  /**
   * Add a peer
   */
  addPeer(peer: SyncPeer): void {
    this.peers.set(peer.peerId, peer);
  }

  /**
   * Remove a peer
   */
  removePeer(peerId: string): void {
    this.peers.delete(peerId);
  }

  /**
   * Get all peers
   */
  getPeers(): SyncPeer[] {
    return Array.from(this.peers.values());
  }

  /**
   * Get a specific peer
   */
  getPeer(peerId: string): SyncPeer | undefined {
    return this.peers.get(peerId);
  }

  /**
   * Update peer state
   */
  updatePeer(peerId: string, update: Partial<SyncPeer>): void {
    const peer = this.peers.get(peerId);
    if (peer) {
      Object.assign(peer, update);
    }
  }

  /**
   * Set the Merkle root for state hashing
   */
  setMerkleRoot(root: MerkleRoot): void {
    this.merkleRoot = root;
  }

  /**
   * Get current vector clock
   */
  getVectorClock(): VectorClock {
    return this.vectorClock.clone();
  }

  /**
   * Get changes since a sequence
   */
  async getChangesSince(sequence: number): Promise<ChangeEntry[]> {
    return this.journal.getAfterSequence(sequence);
  }

  /**
   * Resolve conflict based on strategy
   */
  private resolveConflict(
    local: ChangeEntry,
    remote: ChangeEntry
  ): ChangeEntry | null {
    switch (this.conflictResolution.strategy) {
      case 'last-write-wins':
        // Compare timestamps
        const localTime = new Date(local.timestamp).getTime();
        const remoteTime = new Date(remote.timestamp).getTime();
        return localTime >= remoteTime ? local : remote;

      case 'vector-clock':
        // Use vector clock dominance
        const localClock = VectorClock.fromJSON(local.vectorClock);
        const remoteClock = VectorClock.fromJSON(remote.vectorClock);

        if (localClock.dominates(remoteClock)) {
          return local;
        } else if (remoteClock.dominates(localClock)) {
          return remote;
        }
        // If neither dominates, fall back to timestamp
        return new Date(local.timestamp) >= new Date(remote.timestamp)
          ? local
          : remote;

      case 'merge':
      case 'manual':
        if (this.conflictResolution.resolver) {
          return this.conflictResolution.resolver(local, remote);
        }
        // No resolver provided, fall back to last-write-wins
        return new Date(local.timestamp) >= new Date(remote.timestamp)
          ? local
          : remote;

      default:
        return local;
    }
  }
}

/**
 * Create a StateSyncManager instance
 */
export function createStateSyncManager(options: StateSyncOptions): StateSyncManager {
  return new StateSyncManager(options);
}
