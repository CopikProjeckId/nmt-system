/**
 * HNSW Index Tests
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { HNSWIndex } from '../../src/core/hnsw-index.js';

describe('HNSWIndex', () => {
  let index: HNSWIndex;

  beforeEach(() => {
    index = new HNSWIndex({
      M: 16,
      efConstruction: 200,
      efSearch: 50,
    });
  });

  describe('insert', () => {
    it('should insert a single vector', () => {
      const embedding = createRandomEmbedding(384);
      index.insert('test-id-1', embedding);

      const stats = index.getStats();
      expect(stats.totalNodes).toBe(1);
    });

    it('should insert multiple vectors', () => {
      for (let i = 0; i < 10; i++) {
        const embedding = createRandomEmbedding(384);
        index.insert(`test-id-${i}`, embedding);
      }

      const stats = index.getStats();
      expect(stats.totalNodes).toBe(10);
    });

    it('should throw error for duplicate ID', () => {
      const embedding = createRandomEmbedding(384);
      index.insert('dup-id', embedding);

      expect(() => index.insert('dup-id', embedding)).toThrow('already exists');
    });
  });

  describe('search', () => {
    it('should find the exact match', () => {
      const embedding = createRandomEmbedding(384);
      index.insert('target', embedding);

      const results = index.search(embedding, 1);

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('target');
      expect(results[0].score).toBeCloseTo(1.0, 2);
    });

    it('should return top-k results', () => {
      for (let i = 0; i < 20; i++) {
        const embedding = createRandomEmbedding(384);
        index.insert(`id-${i}`, embedding);
      }

      const query = createRandomEmbedding(384);
      const results = index.search(query, 5);

      expect(results).toHaveLength(5);
      // Results should be sorted by score descending
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    it('should return empty array for empty index', () => {
      const query = createRandomEmbedding(384);
      const results = index.search(query, 5);

      expect(results).toHaveLength(0);
    });
  });

  describe('delete', () => {
    it('should delete a vector', () => {
      const embedding = createRandomEmbedding(384);
      index.insert('to-delete', embedding);

      expect(index.getStats().totalNodes).toBe(1);

      const deleted = index.delete('to-delete');

      expect(deleted).toBe(true);
      expect(index.getStats().totalNodes).toBe(0);
    });

    it('should return false for non-existent node', () => {
      const deleted = index.delete('non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('has', () => {
    it('should return true for existing node', () => {
      const embedding = createRandomEmbedding(384);
      index.insert('exists', embedding);

      expect(index.has('exists')).toBe(true);
    });

    it('should return false for non-existent node', () => {
      expect(index.has('non-existent')).toBe(false);
    });
  });

  describe('getAllIds', () => {
    it('should return all node IDs', () => {
      for (let i = 0; i < 5; i++) {
        index.insert(`node-${i}`, createRandomEmbedding(384));
      }

      const ids = index.getAllIds();

      expect(ids).toHaveLength(5);
      expect(ids).toContain('node-0');
      expect(ids).toContain('node-4');
    });
  });

  describe('serialization', () => {
    it('should serialize and deserialize correctly', () => {
      for (let i = 0; i < 5; i++) {
        const embedding = createRandomEmbedding(384);
        index.insert(`id-${i}`, embedding);
      }

      const serialized = index.serialize();
      expect(serialized.nodes).toHaveLength(5);

      const newIndex = HNSWIndex.deserialize(serialized);

      expect(newIndex.getStats().totalNodes).toBe(5);
      expect(newIndex.has('id-0')).toBe(true);
      expect(newIndex.has('id-4')).toBe(true);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      for (let i = 0; i < 10; i++) {
        index.insert(`node-${i}`, createRandomEmbedding(384));
      }

      const stats = index.getStats();

      expect(stats.totalNodes).toBe(10);
      expect(stats.layerDistribution).toBeDefined();
      expect(stats.avgConnectionsPerLayer).toBeDefined();
    });
  });

  describe('size property', () => {
    it('should return correct size', () => {
      expect(index.size).toBe(0);

      index.insert('n1', createRandomEmbedding(384));
      expect(index.size).toBe(1);

      index.insert('n2', createRandomEmbedding(384));
      expect(index.size).toBe(2);
    });
  });
});

// Helper function
function createRandomEmbedding(dim: number): Float32Array {
  const embedding = new Float32Array(dim);
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    embedding[i] = Math.random() - 0.5;
    norm += embedding[i] * embedding[i];
  }
  norm = Math.sqrt(norm);
  for (let i = 0; i < dim; i++) {
    embedding[i] /= norm;
  }
  return embedding;
}
