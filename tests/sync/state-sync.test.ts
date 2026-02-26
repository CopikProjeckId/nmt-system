/**
 * StateSyncManager Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Level } from 'level';
import * as fs from 'fs/promises';
import { StateSyncManager, createStateSyncManager } from '../../src/sync/state-sync.js';
import { ChangeJournal } from '../../src/sync/change-journal.js';
import { VectorClock } from '../../src/sync/vector-clock.js';
import { MerkleEngine } from '../../src/core/merkle-engine.js';
import { EventBus } from '../../src/events/event-bus.js';

/**
 * Safe directory removal with retry for Windows EBUSY errors
 */
async function safeRemoveDir(dir: string, maxRetries = 3): Promise<void> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch (err: any) {
      if (err.code === 'EBUSY' && attempt < maxRetries - 1) {
        // Wait with exponential backoff before retry
        await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, attempt)));
      } else if (err.code === 'ENOENT') {
        // Directory doesn't exist, that's fine
        return;
      } else {
        throw err;
      }
    }
  }
}

describe('StateSyncManager', () => {
  let db: Level<string, string>;
  let journal: ChangeJournal;
  let merkleEngine: MerkleEngine;
  let eventBus: EventBus;
  let syncManager: StateSyncManager;
  const testDir = './test-data/sync-test';

  beforeEach(async () => {
    // Clean up any leftover from previous runs
    await safeRemoveDir(testDir);
    await fs.mkdir(testDir, { recursive: true });
    db = new Level(testDir, { valueEncoding: 'json' });
    await db.open();

    journal = new ChangeJournal(db, 'node-1');
    merkleEngine = new MerkleEngine();
    eventBus = new EventBus();

    syncManager = new StateSyncManager({
      nodeId: 'node-1',
      journal,
      merkleEngine,
      eventBus,
    });

    await syncManager.init();
  });

  afterEach(async () => {
    try {
      await journal.clear();
    } catch {
      // Ignore clear errors during cleanup
    }
    try {
      await db.close();
    } catch {
      // Ignore close errors during cleanup
    }
    // Wait a bit on Windows for file handles to be released
    if (process.platform === 'win32') {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    await safeRemoveDir(testDir);
  });

  describe('recordChange', () => {
    it('should record a change and return sequence', async () => {
      const seq = await syncManager.recordChange({
        type: 'neuron',
        operation: 'create',
        entityId: 'neuron-123',
        data: { content: 'Hello' },
      });

      expect(seq).toBe(1);
    });

    it('should increment vector clock', async () => {
      await syncManager.recordChange({
        type: 'neuron',
        operation: 'create',
        entityId: 'neuron-1',
        data: {},
      });

      const state = syncManager.getLocalState();
      expect(state.vectorClock.get('node-1')).toBe(1);
    });

    it('should emit state_changed event', async () => {
      const handler = vi.fn();
      eventBus.subscribe('sync:state_changed', handler);

      await syncManager.recordChange({
        type: 'neuron',
        operation: 'create',
        entityId: 'neuron-1',
        data: {},
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('recordChanges (batch)', () => {
    it('should record multiple changes atomically', async () => {
      const sequences = await syncManager.recordChanges([
        { type: 'neuron', operation: 'create', entityId: 'neuron-1', data: {} },
        { type: 'neuron', operation: 'create', entityId: 'neuron-2', data: {} },
        { type: 'synapse', operation: 'create', entityId: 'synapse-1', data: {} },
      ]);

      expect(sequences).toHaveLength(3);
      expect(sequences).toEqual([1, 2, 3]);

      const state = syncManager.getLocalState();
      expect(state.vectorClock.get('node-1')).toBe(3);
    });
  });

  describe('computeStateDiff', () => {
    it('should return no sync needed for equal states', async () => {
      const remoteState = {
        nodeId: 'node-2',
        merkleRoot: null,
        vectorClock: new VectorClock('node-2'),
        sequence: 0,
        lastSync: null,
      };

      const diff = await syncManager.computeStateDiff(remoteState);

      expect(diff.needsSync).toBe(false);
      expect(diff.localAhead).toHaveLength(0);
      expect(diff.remoteAhead).toHaveLength(0);
    });

    it('should detect local ahead', async () => {
      await syncManager.recordChange({
        type: 'neuron',
        operation: 'create',
        entityId: 'neuron-1',
        data: {},
      });

      await syncManager.recordChange({
        type: 'neuron',
        operation: 'create',
        entityId: 'neuron-2',
        data: {},
      });

      const remoteState = {
        nodeId: 'node-2',
        merkleRoot: null,
        vectorClock: new VectorClock('node-2'),
        sequence: 0,
        lastSync: null,
      };

      const diff = await syncManager.computeStateDiff(remoteState);

      expect(diff.needsSync).toBe(true);
      expect(diff.localAhead).toHaveLength(2);
    });

    it('should detect remote ahead', async () => {
      const remoteClock = new VectorClock('node-2');
      remoteClock.set('node-2', 5);

      const remoteState = {
        nodeId: 'node-2',
        merkleRoot: null,
        vectorClock: remoteClock,
        sequence: 5,
        lastSync: null,
      };

      const diff = await syncManager.computeStateDiff(remoteState);

      expect(diff.needsSync).toBe(true);
      expect(diff.remoteAhead).toHaveLength(5);
    });

    it('should detect concurrent changes', async () => {
      await syncManager.recordChange({
        type: 'neuron',
        operation: 'create',
        entityId: 'neuron-1',
        data: {},
      });

      const remoteClock = new VectorClock('node-2');
      remoteClock.set('node-2', 2);

      const remoteState = {
        nodeId: 'node-2',
        merkleRoot: null,
        vectorClock: remoteClock,
        sequence: 2,
        lastSync: null,
      };

      const diff = await syncManager.computeStateDiff(remoteState);

      expect(diff.needsSync).toBe(true);
    });
  });

  describe('applyRemoteChanges', () => {
    it('should apply remote changes', async () => {
      const remoteChanges = [
        {
          sequence: 1,
          type: 'neuron' as const,
          operation: 'create' as const,
          entityId: 'remote-neuron-1',
          data: { content: 'Remote' },
          vectorClock: { 'node-2': 1 },
          timestamp: new Date().toISOString(),
          nodeId: 'node-2',
        },
      ];

      const result = await syncManager.applyRemoteChanges(remoteChanges);

      expect(result.applied).toBe(1);
      expect(result.conflicts).toBe(0);
    });

    it('should merge vector clocks when applying', async () => {
      const remoteChanges = [
        {
          sequence: 1,
          type: 'neuron' as const,
          operation: 'create' as const,
          entityId: 'remote-neuron-1',
          data: {},
          vectorClock: { 'node-2': 5 },
          timestamp: new Date().toISOString(),
          nodeId: 'node-2',
        },
      ];

      await syncManager.applyRemoteChanges(remoteChanges);

      const state = syncManager.getLocalState();
      expect(state.vectorClock.get('node-2')).toBe(5);
    });

    it('should detect and resolve conflicts', async () => {
      // Create local change
      await syncManager.recordChange({
        type: 'neuron',
        operation: 'create',
        entityId: 'shared-neuron',
        data: { value: 'local' },
      });

      // Remote change with concurrent clock
      const remoteChanges = [
        {
          sequence: 1,
          type: 'neuron' as const,
          operation: 'update' as const,
          entityId: 'shared-neuron',
          data: { value: 'remote' },
          vectorClock: { 'node-2': 1 }, // Concurrent with local
          timestamp: new Date(Date.now() + 1000).toISOString(), // Newer timestamp
          nodeId: 'node-2',
        },
      ];

      const conflictHandler = vi.fn();
      syncManager.onConflict(conflictHandler);

      const result = await syncManager.applyRemoteChanges(remoteChanges);

      expect(result.conflicts).toBe(1);
      expect(conflictHandler).toHaveBeenCalled();
    });
  });

  describe('getLocalState', () => {
    it('should return current state', async () => {
      await syncManager.recordChange({
        type: 'neuron',
        operation: 'create',
        entityId: 'neuron-1',
        data: {},
      });

      const state = syncManager.getLocalState();

      expect(state.nodeId).toBe('node-1');
      expect(state.vectorClock.get('node-1')).toBe(1);
    });
  });

  describe('getLocalStateAsync', () => {
    it('should return state with sequence', async () => {
      await syncManager.recordChange({
        type: 'neuron',
        operation: 'create',
        entityId: 'neuron-1',
        data: {},
      });

      const state = await syncManager.getLocalStateAsync();

      expect(state.sequence).toBe(1);
      expect(state.lastSync).toBeDefined();
    });
  });

  describe('peer management', () => {
    it('should add and get peers', () => {
      syncManager.addPeer({
        peerId: 'node-2',
        endpoint: 'http://node2:3000',
        lastSeen: Date.now(),
        lastSequence: 0,
        vectorClock: {},
        status: 'connected',
      });

      const peers = syncManager.getPeers();
      expect(peers).toHaveLength(1);
      expect(peers[0].peerId).toBe('node-2');
    });

    it('should remove peer', () => {
      syncManager.addPeer({
        peerId: 'node-2',
        endpoint: 'http://node2:3000',
        lastSeen: Date.now(),
        lastSequence: 0,
        vectorClock: {},
        status: 'connected',
      });

      syncManager.removePeer('node-2');

      const peers = syncManager.getPeers();
      expect(peers).toHaveLength(0);
    });

    it('should update peer', () => {
      syncManager.addPeer({
        peerId: 'node-2',
        endpoint: 'http://node2:3000',
        lastSeen: Date.now(),
        lastSequence: 0,
        vectorClock: {},
        status: 'disconnected',
      });

      syncManager.updatePeer('node-2', { status: 'connected' });

      const peer = syncManager.getPeer('node-2');
      expect(peer?.status).toBe('connected');
    });
  });

  describe('onConflict handler', () => {
    it('should register and call conflict handler', async () => {
      const handler = vi.fn();
      const unsubscribe = syncManager.onConflict(handler);

      // Create local change
      await syncManager.recordChange({
        type: 'neuron',
        operation: 'create',
        entityId: 'conflict-test',
        data: {},
      });

      // Apply conflicting remote change
      await syncManager.applyRemoteChanges([
        {
          sequence: 1,
          type: 'neuron',
          operation: 'update',
          entityId: 'conflict-test',
          data: {},
          vectorClock: { 'node-2': 1 },
          timestamp: new Date().toISOString(),
          nodeId: 'node-2',
        },
      ]);

      expect(handler).toHaveBeenCalled();

      // Unsubscribe and verify
      unsubscribe();
    });
  });

  describe('conflict resolution strategies', () => {
    it('should use last-write-wins by default', async () => {
      // Create local change with earlier timestamp
      await syncManager.recordChange({
        type: 'neuron',
        operation: 'create',
        entityId: 'lww-test',
        data: { value: 'local' },
      });

      // Apply remote change with later timestamp
      const result = await syncManager.applyRemoteChanges([
        {
          sequence: 1,
          type: 'neuron',
          operation: 'update',
          entityId: 'lww-test',
          data: { value: 'remote' },
          vectorClock: { 'node-2': 1 },
          timestamp: new Date(Date.now() + 10000).toISOString(),
          nodeId: 'node-2',
        },
      ]);

      expect(result.conflicts).toBe(1);
      expect(result.resolved).toHaveLength(1);
      // Remote wins because of later timestamp
      expect(result.resolved[0].data).toEqual({ value: 'remote' });
    });

    it('should support custom resolver', async () => {
      const customSync = new StateSyncManager({
        nodeId: 'node-1',
        journal,
        merkleEngine,
        eventBus,
        conflictResolution: {
          strategy: 'merge',
          resolver: (local, remote) => ({
            ...local,
            data: { merged: true, localValue: (local.data as any).value, remoteValue: (remote.data as any).value },
          }),
        },
      });

      await customSync.init();

      await customSync.recordChange({
        type: 'neuron',
        operation: 'create',
        entityId: 'merge-test',
        data: { value: 'local' },
      });

      const result = await customSync.applyRemoteChanges([
        {
          sequence: 1,
          type: 'neuron',
          operation: 'update',
          entityId: 'merge-test',
          data: { value: 'remote' },
          vectorClock: { 'node-2': 1 },
          timestamp: new Date().toISOString(),
          nodeId: 'node-2',
        },
      ]);

      expect(result.resolved[0].data).toEqual({
        merged: true,
        localValue: 'local',
        remoteValue: 'remote',
      });
    });
  });

  describe('getChangesSince', () => {
    it('should return changes since sequence', async () => {
      await syncManager.recordChange({
        type: 'neuron',
        operation: 'create',
        entityId: 'neuron-1',
        data: {},
      });

      await syncManager.recordChange({
        type: 'neuron',
        operation: 'create',
        entityId: 'neuron-2',
        data: {},
      });

      await syncManager.recordChange({
        type: 'neuron',
        operation: 'create',
        entityId: 'neuron-3',
        data: {},
      });

      const changes = await syncManager.getChangesSince(1);

      expect(changes).toHaveLength(2);
      expect(changes[0].entityId).toBe('neuron-2');
    });
  });

  describe('createStateSyncManager factory', () => {
    it('should create manager instance', () => {
      const manager = createStateSyncManager({
        nodeId: 'test-node',
        journal,
        merkleEngine,
      });

      expect(manager).toBeInstanceOf(StateSyncManager);
    });
  });
});
