/**
 * ChangeJournal Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Level } from 'level';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ChangeJournal, createChangeJournal } from '../../src/sync/change-journal.js';

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

describe('ChangeJournal', () => {
  let db: Level<string, string>;
  let journal: ChangeJournal;
  const testDir = './test-data/journal-test';

  beforeEach(async () => {
    // Clean up any leftover from previous runs
    await safeRemoveDir(testDir);
    await fs.mkdir(testDir, { recursive: true });
    db = new Level(testDir, { valueEncoding: 'json' });
    await db.open();
    journal = new ChangeJournal(db, 'test-node');
    await journal.init();
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

  describe('append', () => {
    it('should append entry and return sequence', async () => {
      const seq = await journal.append({
        type: 'neuron',
        operation: 'create',
        entityId: 'neuron-123',
        data: { content: 'Hello' },
        vectorClock: { 'test-node': 1 },
        timestamp: new Date().toISOString(),
        nodeId: 'test-node',
      });

      expect(seq).toBe(1);
    });

    it('should increment sequence for each append', async () => {
      const seq1 = await journal.append({
        type: 'neuron',
        operation: 'create',
        entityId: 'neuron-1',
        data: {},
        vectorClock: {},
        timestamp: new Date().toISOString(),
        nodeId: 'test-node',
      });

      const seq2 = await journal.append({
        type: 'neuron',
        operation: 'create',
        entityId: 'neuron-2',
        data: {},
        vectorClock: {},
        timestamp: new Date().toISOString(),
        nodeId: 'test-node',
      });

      expect(seq1).toBe(1);
      expect(seq2).toBe(2);
    });
  });

  describe('appendBatch', () => {
    it('should append multiple entries atomically', async () => {
      const entries = [
        {
          type: 'neuron' as const,
          operation: 'create' as const,
          entityId: 'neuron-1',
          data: {},
          vectorClock: {},
          timestamp: new Date().toISOString(),
          nodeId: 'test-node',
        },
        {
          type: 'synapse' as const,
          operation: 'create' as const,
          entityId: 'synapse-1',
          data: {},
          vectorClock: {},
          timestamp: new Date().toISOString(),
          nodeId: 'test-node',
        },
      ];

      const sequences = await journal.appendBatch(entries);

      expect(sequences).toHaveLength(2);
      expect(sequences[0]).toBe(1);
      expect(sequences[1]).toBe(2);
    });
  });

  describe('get', () => {
    it('should retrieve entry by sequence', async () => {
      await journal.append({
        type: 'neuron',
        operation: 'create',
        entityId: 'neuron-123',
        data: { content: 'Test' },
        vectorClock: { node: 1 },
        timestamp: '2024-01-01T00:00:00Z',
        nodeId: 'test-node',
      });

      const entry = await journal.get(1);

      expect(entry).not.toBeNull();
      expect(entry!.entityId).toBe('neuron-123');
      expect(entry!.data).toEqual({ content: 'Test' });
    });

    it('should return null for non-existent sequence', async () => {
      const entry = await journal.get(999);
      expect(entry).toBeNull();
    });
  });

  describe('getRange', () => {
    it('should retrieve entries in range', async () => {
      for (let i = 0; i < 5; i++) {
        await journal.append({
          type: 'neuron',
          operation: 'create',
          entityId: `neuron-${i}`,
          data: {},
          vectorClock: {},
          timestamp: new Date().toISOString(),
          nodeId: 'test-node',
        });
      }

      const entries = await journal.getRange(2, 4);

      expect(entries).toHaveLength(3);
      expect(entries[0].entityId).toBe('neuron-1');
      expect(entries[2].entityId).toBe('neuron-3');
    });
  });

  describe('getAfterSequence', () => {
    it('should get all entries after sequence', async () => {
      for (let i = 0; i < 5; i++) {
        await journal.append({
          type: 'neuron',
          operation: 'create',
          entityId: `neuron-${i}`,
          data: {},
          vectorClock: {},
          timestamp: new Date().toISOString(),
          nodeId: 'test-node',
        });
      }

      const entries = await journal.getAfterSequence(3);

      expect(entries).toHaveLength(2);
      expect(entries[0].sequence).toBe(4);
      expect(entries[1].sequence).toBe(5);
    });
  });

  describe('getByEntity', () => {
    it('should get all entries for an entity', async () => {
      await journal.append({
        type: 'neuron',
        operation: 'create',
        entityId: 'neuron-1',
        data: { v: 1 },
        vectorClock: {},
        timestamp: new Date().toISOString(),
        nodeId: 'test-node',
      });

      await journal.append({
        type: 'neuron',
        operation: 'update',
        entityId: 'neuron-1',
        data: { v: 2 },
        vectorClock: {},
        timestamp: new Date().toISOString(),
        nodeId: 'test-node',
      });

      await journal.append({
        type: 'neuron',
        operation: 'create',
        entityId: 'neuron-2',
        data: {},
        vectorClock: {},
        timestamp: new Date().toISOString(),
        nodeId: 'test-node',
      });

      const entries = await journal.getByEntity('neuron-1');

      expect(entries).toHaveLength(2);
      expect(entries[0].operation).toBe('create');
      expect(entries[1].operation).toBe('update');
    });
  });

  describe('getByType', () => {
    it('should get all entries of a type', async () => {
      await journal.append({
        type: 'neuron',
        operation: 'create',
        entityId: 'neuron-1',
        data: {},
        vectorClock: {},
        timestamp: new Date().toISOString(),
        nodeId: 'test-node',
      });

      await journal.append({
        type: 'synapse',
        operation: 'create',
        entityId: 'synapse-1',
        data: {},
        vectorClock: {},
        timestamp: new Date().toISOString(),
        nodeId: 'test-node',
      });

      await journal.append({
        type: 'neuron',
        operation: 'update',
        entityId: 'neuron-1',
        data: {},
        vectorClock: {},
        timestamp: new Date().toISOString(),
        nodeId: 'test-node',
      });

      const entries = await journal.getByType('neuron');

      expect(entries).toHaveLength(2);
    });
  });

  describe('getLatestSequence', () => {
    it('should return 0 for empty journal', async () => {
      const seq = await journal.getLatestSequence();
      expect(seq).toBe(0);
    });

    it('should return latest sequence', async () => {
      await journal.append({
        type: 'neuron',
        operation: 'create',
        entityId: 'neuron-1',
        data: {},
        vectorClock: {},
        timestamp: new Date().toISOString(),
        nodeId: 'test-node',
      });

      await journal.append({
        type: 'neuron',
        operation: 'create',
        entityId: 'neuron-2',
        data: {},
        vectorClock: {},
        timestamp: new Date().toISOString(),
        nodeId: 'test-node',
      });

      const seq = await journal.getLatestSequence();
      expect(seq).toBe(2);
    });
  });

  describe('compact', () => {
    it('should remove entries before sequence', async () => {
      for (let i = 0; i < 5; i++) {
        await journal.append({
          type: 'neuron',
          operation: 'create',
          entityId: `neuron-${i}`,
          data: {},
          vectorClock: {},
          timestamp: new Date().toISOString(),
          nodeId: 'test-node',
        });
      }

      const deleted = await journal.compact(3);

      expect(deleted).toBe(2);

      const entry1 = await journal.get(1);
      const entry3 = await journal.get(3);

      expect(entry1).toBeNull();
      expect(entry3).not.toBeNull();
    });
  });

  describe('getStats', () => {
    it('should return journal statistics', async () => {
      await journal.append({
        type: 'neuron',
        operation: 'create',
        entityId: 'neuron-1',
        data: {},
        vectorClock: {},
        timestamp: new Date().toISOString(),
        nodeId: 'test-node',
      });

      await journal.append({
        type: 'synapse',
        operation: 'create',
        entityId: 'synapse-1',
        data: {},
        vectorClock: {},
        timestamp: new Date().toISOString(),
        nodeId: 'test-node',
      });

      await journal.append({
        type: 'neuron',
        operation: 'update',
        entityId: 'neuron-1',
        data: {},
        vectorClock: {},
        timestamp: new Date().toISOString(),
        nodeId: 'test-node',
      });

      const stats = await journal.getStats();

      expect(stats.totalEntries).toBe(3);
      expect(stats.latestSequence).toBe(3);
      expect(stats.byType['neuron']).toBe(2);
      expect(stats.byType['synapse']).toBe(1);
      expect(stats.byOperation['create']).toBe(2);
      expect(stats.byOperation['update']).toBe(1);
    });
  });

  describe('clear', () => {
    it('should remove all entries', async () => {
      for (let i = 0; i < 3; i++) {
        await journal.append({
          type: 'neuron',
          operation: 'create',
          entityId: `neuron-${i}`,
          data: {},
          vectorClock: {},
          timestamp: new Date().toISOString(),
          nodeId: 'test-node',
        });
      }

      await journal.clear();

      const hasEntries = await journal.hasEntries();
      expect(hasEntries).toBe(false);

      const seq = await journal.getLatestSequence();
      expect(seq).toBe(0);
    });
  });

  describe('persistence', () => {
    it('should persist sequence across restarts', async () => {
      await journal.append({
        type: 'neuron',
        operation: 'create',
        entityId: 'neuron-1',
        data: {},
        vectorClock: {},
        timestamp: new Date().toISOString(),
        nodeId: 'test-node',
      });

      // Create new journal instance
      const journal2 = new ChangeJournal(db, 'test-node');
      await journal2.init();

      const seq = await journal2.getLatestSequence();
      expect(seq).toBe(1);

      // Append should continue from last sequence
      const newSeq = await journal2.append({
        type: 'neuron',
        operation: 'create',
        entityId: 'neuron-2',
        data: {},
        vectorClock: {},
        timestamp: new Date().toISOString(),
        nodeId: 'test-node',
      });

      expect(newSeq).toBe(2);
    });
  });

  describe('createChangeJournal factory', () => {
    it('should create journal instance', () => {
      const j = createChangeJournal(db, 'test-node');
      expect(j).toBeInstanceOf(ChangeJournal);
    });
  });
});
