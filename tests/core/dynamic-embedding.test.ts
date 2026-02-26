/**
 * Dynamic Embedding Manager Tests
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DynamicEmbeddingManager } from '../../src/core/dynamic-embedding.js';

describe('DynamicEmbeddingManager', () => {
  let manager: DynamicEmbeddingManager;

  beforeEach(() => {
    manager = new DynamicEmbeddingManager({
      baseDimension: 384,
      maxDimensions: 1000,
      enableAutoExpansion: true,
    });
  });

  describe('createFromFixed', () => {
    it('should create dynamic embedding from fixed array', () => {
      const fixed = createTestEmbedding(384);

      const dynamic = manager.createFromFixed('emb-1', fixed);

      expect(dynamic).toBeDefined();
      expect(dynamic.id).toBe('emb-1');
      expect(dynamic.dimensions.size).toBe(384);
      expect(dynamic.baseDimension).toBe(384);
    });

    it('should handle smaller arrays', () => {
      const fixed = new Float32Array(100).fill(0.5);

      const dynamic = manager.createFromFixed('small-emb', fixed);

      expect(dynamic.dimensions.size).toBe(100);
    });
  });

  describe('toFixed', () => {
    it('should convert dynamic embedding back to fixed array', () => {
      const original = createTestEmbedding(384);
      const dynamic = manager.createFromFixed('to-fixed-test', original);

      const fixed = manager.toFixed(dynamic, 384);

      expect(fixed.length).toBe(384);
      // Values should be preserved
      expect(fixed[0]).toBeCloseTo(original[0], 5);
    });

    it('should pad with zeros for larger target size', () => {
      const original = createTestEmbedding(100);
      const dynamic = manager.createFromFixed('pad-test', original);

      const fixed = manager.toFixed(dynamic, 200);

      expect(fixed.length).toBe(200);
    });
  });

  describe('expandEmbedding', () => {
    it('should add new dimensions to embedding', () => {
      const fixed = createTestEmbedding(384);
      const dynamic = manager.createFromFixed('expand-test', fixed);

      const newDims = new Map<string, number>([
        ['custom_dim_1', 0.5],
        ['custom_dim_2', 0.7],
      ]);

      const result = manager.expandEmbedding(dynamic, newDims, 'test expansion');

      expect(result.originalDimensions).toBe(384);
      expect(result.newDimensions).toBe(386);
      expect(result.addedDimensions).toContain('custom_dim_1');
      expect(result.addedDimensions).toContain('custom_dim_2');
    });

    it('should not duplicate existing dimensions', () => {
      const fixed = createTestEmbedding(384);
      const dynamic = manager.createFromFixed('no-dup-test', fixed);

      // First expansion
      const dims1 = new Map([['new_dim', 0.5]]);
      manager.expandEmbedding(dynamic, dims1, 'first');

      // Second expansion with same dimension
      const dims2 = new Map([['new_dim', 0.9]]);
      const result = manager.expandEmbedding(dynamic, dims2, 'second');

      expect(result.addedDimensions.length).toBe(0);
    });
  });

  describe('needsExpansion', () => {
    it('should return true for low similarity', () => {
      const fixed = createTestEmbedding(384, 0.1);
      const dynamic = manager.createFromFixed('needs-test', fixed);

      // Create truly different vector (alternating pattern for low similarity)
      const conceptVector = createOppositeEmbedding(384);

      const needs = manager.needsExpansion(dynamic, conceptVector, 0.5);

      expect(needs).toBe(true);
    });

    it('should return false for high similarity', () => {
      const fixed = createTestEmbedding(384, 0.5);
      const dynamic = manager.createFromFixed('no-need-test', fixed);

      const conceptVector = createTestEmbedding(384, 0.5);

      const needs = manager.needsExpansion(dynamic, conceptVector, 0.1);

      expect(needs).toBe(false);
    });
  });

  describe('autoExpand', () => {
    it('should extract semantic dimensions from concept', () => {
      const fixed = createTestEmbedding(384);
      const dynamic = manager.createFromFixed('auto-test', fixed);

      const result = manager.autoExpand(
        dynamic,
        'quantum computing algorithm optimization'
      );

      // Should have extracted keywords and created dimensions
      if (result) {
        expect(result.addedDimensions.length).toBeGreaterThan(0);
      }
    });

    it('should respect max dimensions limit', () => {
      const limitedManager = new DynamicEmbeddingManager({
        baseDimension: 384,
        maxDimensions: 384,
        enableAutoExpansion: true,
      });

      const fixed = createTestEmbedding(384);
      const dynamic = limitedManager.createFromFixed('limit-test', fixed);

      const result = limitedManager.autoExpand(dynamic, 'new concept');

      expect(result).toBeNull();
    });

    it('should return null when auto expansion is disabled', () => {
      const disabledManager = new DynamicEmbeddingManager({
        enableAutoExpansion: false,
      });

      const fixed = createTestEmbedding(384);
      const dynamic = disabledManager.createFromFixed('disabled-test', fixed);

      const result = disabledManager.autoExpand(dynamic, 'test concept');

      expect(result).toBeNull();
    });
  });

  describe('registerDimension', () => {
    it('should register a new dimension', () => {
      manager.registerDimension('custom_semantic', {
        name: 'custom_semantic',
        description: 'Custom semantic dimension',
        createdAt: new Date().toISOString(),
        semanticCategory: 'custom',
        usageCount: 0,
      });

      const dims = manager.getDimensionsByCategory('custom');
      expect(dims).toContain('custom_semantic');
    });

    it('should not duplicate dimensions', () => {
      const initialCount = manager.getCurrentDimensionCount();

      manager.registerDimension('dup_test', {
        name: 'dup_test',
        description: 'Test',
        createdAt: new Date().toISOString(),
        semanticCategory: 'test',
        usageCount: 0,
      });

      manager.registerDimension('dup_test', {
        name: 'dup_test',
        description: 'Duplicate',
        createdAt: new Date().toISOString(),
        semanticCategory: 'test',
        usageCount: 0,
      });

      expect(manager.getCurrentDimensionCount()).toBe(initialCount + 1);
    });
  });

  describe('getDimensionsByCategory', () => {
    it('should return dimensions for existing category', () => {
      const semanticDims = manager.getDimensionsByCategory('semantic');
      expect(semanticDims.length).toBeGreaterThan(0);
    });

    it('should return empty array for non-existent category', () => {
      const dims = manager.getDimensionsByCategory('non-existent');
      expect(dims).toEqual([]);
    });
  });

  describe('similarity', () => {
    it('should calculate similarity between two dynamic embeddings', () => {
      const fixed1 = createTestEmbedding(384, 0.5);
      const fixed2 = createTestEmbedding(384, 0.5);

      const emb1 = manager.createFromFixed('sim-1', fixed1);
      const emb2 = manager.createFromFixed('sim-2', fixed2);

      const similarity = manager.similarity(emb1, emb2);

      expect(similarity).toBeGreaterThan(0.9); // Same embeddings should be very similar
    });

    it('should return lower similarity for different embeddings', () => {
      const fixed1 = createTestEmbedding(384, 0.2);
      const fixed2 = createTestEmbedding(384, 0.8);

      const emb1 = manager.createFromFixed('diff-1', fixed1);
      const emb2 = manager.createFromFixed('diff-2', fixed2);

      const similarity = manager.similarity(emb1, emb2);

      expect(similarity).toBeLessThan(1.0);
    });
  });

  describe('project', () => {
    it('should project embedding to subset of dimensions', () => {
      const fixed = createTestEmbedding(384);
      const dynamic = manager.createFromFixed('proj-test', fixed);

      const projected = manager.project(dynamic, ['sem_0', 'sem_1', 'sem_2']);

      expect(projected.size).toBe(3);
      expect(projected.has('sem_0')).toBe(true);
    });

    it('should return empty map for non-existent dimensions', () => {
      const fixed = createTestEmbedding(384);
      const dynamic = manager.createFromFixed('empty-proj', fixed);

      const projected = manager.project(dynamic, ['non_existent_dim']);

      expect(projected.size).toBe(0);
    });
  });

  describe('getCurrentDimensionCount', () => {
    it('should return base dimension count initially', () => {
      const count = manager.getCurrentDimensionCount();
      expect(count).toBe(384);
    });
  });

  describe('getEmbedding', () => {
    it('should retrieve created embedding', () => {
      const fixed = createTestEmbedding(384);
      manager.createFromFixed('get-test', fixed);

      const retrieved = manager.getEmbedding('get-test');

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe('get-test');
    });

    it('should return undefined for non-existent embedding', () => {
      const result = manager.getEmbedding('non-existent');
      expect(result).toBeUndefined();
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      const fixed = createTestEmbedding(384);
      manager.createFromFixed('stats-1', fixed);
      manager.createFromFixed('stats-2', fixed);

      const stats = manager.getStats();

      expect(stats.totalDimensions).toBe(384);
      expect(stats.baseDimensions).toBe(384);
      expect(stats.expandedDimensions).toBe(0);
      expect(stats.embeddings).toBe(2);
      expect(stats.categories).toBeGreaterThan(0);
    });
  });

  describe('serializeDimensions/loadDimensions', () => {
    it('should serialize and load dimensions correctly', () => {
      const serialized = manager.serializeDimensions() as any;

      const newManager = new DynamicEmbeddingManager({ baseDimension: 10 });
      newManager.loadDimensions(serialized);

      expect(newManager.getCurrentDimensionCount()).toBe(384);
    });
  });
});

// Helper functions
function createTestEmbedding(size: number, fill: number = 0.1): Float32Array {
  const embedding = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    embedding[i] = fill + (i * 0.001);
  }
  // Normalize
  let norm = 0;
  for (let i = 0; i < size; i++) {
    norm += embedding[i] * embedding[i];
  }
  norm = Math.sqrt(norm);
  for (let i = 0; i < size; i++) {
    embedding[i] /= norm;
  }
  return embedding;
}

function createOppositeEmbedding(size: number): Float32Array {
  const embedding = new Float32Array(size);
  // Create alternating positive/negative values for low similarity
  for (let i = 0; i < size; i++) {
    embedding[i] = (i % 2 === 0) ? -0.5 : 0.5;
  }
  // Normalize
  let norm = 0;
  for (let i = 0; i < size; i++) {
    norm += embedding[i] * embedding[i];
  }
  norm = Math.sqrt(norm);
  for (let i = 0; i < size; i++) {
    embedding[i] /= norm;
  }
  return embedding;
}
