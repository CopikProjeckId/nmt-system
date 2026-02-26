/**
 * Attractor Model Tests
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AttractorModel } from '../../src/core/attractor-model.js';
import type { NeuronNode } from '../../src/types/index.js';

// Mock neuron store
const mockStore = {
  getNeuron: vi.fn(),
  getOutgoingSynapses: vi.fn(),
  getIncomingSynapses: vi.fn(),
};

describe('AttractorModel', () => {
  let model: AttractorModel;

  beforeEach(() => {
    vi.clearAllMocks();
    model = new AttractorModel({
      neuronStore: mockStore as any,
      maxAttractors: 10,
      defaultStrength: 0.5,
    });
  });

  describe('createAttractor', () => {
    it('should create an attractor with given parameters', () => {
      const embedding = createTestEmbedding();
      const attractor = model.createAttractor(
        'attractor-1',
        'Goal 1',
        'Test goal description',
        embedding,
        { priority: 8, strength: 0.7 }
      );

      expect(attractor).toBeDefined();
      expect(attractor.id).toBe('attractor-1');
      expect(attractor.name).toBe('Goal 1');
      expect(attractor.priority).toBe(8);
      expect(attractor.strength).toBe(0.7);
    });

    it('should use default values when options not provided', () => {
      const embedding = createTestEmbedding();
      const attractor = model.createAttractor(
        'attractor-2',
        'Goal 2',
        'Description',
        embedding
      );

      expect(attractor.strength).toBe(0.5); // defaultStrength
      expect(attractor.priority).toBe(5); // default priority
    });

    it('should prune weakest attractor when limit reached', () => {
      const embedding = createTestEmbedding();

      // Create max attractors
      for (let i = 0; i < 10; i++) {
        model.createAttractor(`att-${i}`, `Goal ${i}`, 'desc', embedding, {
          strength: i * 0.1,
          activations: i,
        } as any);
      }

      // Adding one more should prune the weakest
      model.createAttractor('att-new', 'New Goal', 'desc', embedding);

      const stats = model.getStats();
      expect(stats.totalAttractors).toBe(10);
    });
  });

  describe('getAttractor', () => {
    it('should retrieve existing attractor', () => {
      const embedding = createTestEmbedding();
      model.createAttractor('test-id', 'Test', 'desc', embedding);

      const retrieved = model.getAttractor('test-id');
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('Test');
    });

    it('should return undefined for non-existent attractor', () => {
      const result = model.getAttractor('non-existent');
      expect(result).toBeUndefined();
    });
  });

  describe('updateAttractor', () => {
    it('should update attractor properties', () => {
      const embedding = createTestEmbedding();
      model.createAttractor('update-test', 'Original', 'desc', embedding);

      const updated = model.updateAttractor('update-test', {
        name: 'Updated',
        priority: 10,
      });

      expect(updated?.name).toBe('Updated');
      expect(updated?.priority).toBe(10);
    });

    it('should return null for non-existent attractor', () => {
      const result = model.updateAttractor('non-existent', { name: 'Test' });
      expect(result).toBeNull();
    });
  });

  describe('calculateInfluence', () => {
    it('should calculate influence based on embedding similarity', () => {
      const embedding1 = createTestEmbedding(0.5);
      const embedding2 = createTestEmbedding(0.5);

      model.createAttractor('inf-1', 'Goal', 'desc', embedding1, {
        strength: 0.8,
        priority: 7,
      });

      const influences = model.calculateInfluence(embedding2);

      expect(influences.size).toBe(1);
      expect(influences.get('inf-1')).toBeGreaterThan(0);
    });

    it('should return empty map when no attractors exist', () => {
      const embedding = createTestEmbedding();
      const influences = model.calculateInfluence(embedding);

      expect(influences.size).toBe(0);
    });
  });

  describe('getDominantAttractor', () => {
    it('should return attractor with highest influence', () => {
      const embedding = createTestEmbedding(0.3);
      const nearEmbedding = createTestEmbedding(0.3);
      const farEmbedding = createTestEmbedding(0.9);

      model.createAttractor('near', 'Near Goal', 'desc', nearEmbedding, {
        strength: 0.8,
      });
      model.createAttractor('far', 'Far Goal', 'desc', farEmbedding, {
        strength: 0.8,
      });

      const dominant = model.getDominantAttractor(embedding);

      expect(dominant).toBeDefined();
      expect(dominant?.id).toBe('near');
    });

    it('should return null when no attractors exist', () => {
      const embedding = createTestEmbedding();
      const dominant = model.getDominantAttractor(embedding);

      expect(dominant).toBeNull();
    });
  });

  describe('getActiveAttractors', () => {
    it('should return attractors with strength above threshold', () => {
      const embedding = createTestEmbedding();

      model.createAttractor('strong', 'Strong', 'desc', embedding, { strength: 0.8 });
      model.createAttractor('weak', 'Weak', 'desc', embedding, { strength: 0.05 });

      const active = model.getActiveAttractors();

      expect(active.length).toBe(1);
      expect(active[0].id).toBe('strong');
    });
  });

  describe('decayAttractors', () => {
    it('should decay strength of inactive attractors', () => {
      const embedding = createTestEmbedding();
      const attractor = model.createAttractor('decay-test', 'Test', 'desc', embedding, {
        strength: 0.5,
      });

      // Manually set old updatedAt
      const oldDate = new Date();
      oldDate.setHours(oldDate.getHours() - 30);
      (attractor as any).updatedAt = oldDate.toISOString();

      model.decayAttractors();

      const updated = model.getAttractor('decay-test');
      expect(updated?.strength).toBeLessThan(0.5);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      const embedding = createTestEmbedding();

      model.createAttractor('s1', 'G1', 'desc', embedding, { strength: 0.6 });
      model.createAttractor('s2', 'G2', 'desc', embedding, { strength: 0.4 });

      const stats = model.getStats();

      expect(stats.totalAttractors).toBe(2);
      expect(stats.activeAttractors).toBe(2);
      expect(stats.averageStrength).toBe(0.5);
    });
  });

  describe('serialize/load', () => {
    it('should serialize and load correctly', () => {
      const embedding = createTestEmbedding();
      model.createAttractor('ser-1', 'Goal 1', 'desc', embedding);
      model.createAttractor('ser-2', 'Goal 2', 'desc', embedding);

      const serialized = model.serialize();

      const newModel = new AttractorModel({
        neuronStore: mockStore as any,
      });
      newModel.load(serialized);

      expect(newModel.getAttractor('ser-1')).toBeDefined();
      expect(newModel.getAttractor('ser-2')).toBeDefined();
    });
  });
});

// Helper function
function createTestEmbedding(fill: number = 0.1): Float32Array {
  const embedding = new Float32Array(384);
  for (let i = 0; i < 384; i++) {
    embedding[i] = fill + (i * 0.001);
  }
  // Normalize
  let norm = 0;
  for (let i = 0; i < 384; i++) {
    norm += embedding[i] * embedding[i];
  }
  norm = Math.sqrt(norm);
  for (let i = 0; i < 384; i++) {
    embedding[i] /= norm;
  }
  return embedding;
}
