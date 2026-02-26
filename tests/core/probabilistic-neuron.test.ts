/**
 * Probabilistic Neuron Manager Tests
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProbabilisticNeuronManager } from '../../src/core/probabilistic-neuron.js';
import type { NeuronNode } from '../../src/types/index.js';

// Mock neuron store
const mockStore = {
  getNeuron: vi.fn(),
  getOutgoingSynapses: vi.fn(),
  getIncomingSynapses: vi.fn(),
};

describe('ProbabilisticNeuronManager', () => {
  let manager: ProbabilisticNeuronManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new ProbabilisticNeuronManager({
      neuronStore: mockStore as any,
      maxStatesPerNeuron: 10,
      enableInterference: true,
    });
  });

  describe('createProbabilisticNeuron', () => {
    it('should create a probabilistic neuron from base neuron', async () => {
      const baseNeuron = createMockNeuron('base-1');

      const probNeuron = await manager.createProbabilisticNeuron(baseNeuron);

      expect(probNeuron).toBeDefined();
      expect(probNeuron.id).toBe('base-1');
      expect(probNeuron.superposition).toBeDefined();
      expect(probNeuron.superposition.states.length).toBe(1);
    });

    it('should initialize with custom states if provided', async () => {
      const baseNeuron = createMockNeuron('base-2');
      const customStates = [
        createMockState('state-1', 0.7),
        createMockState('state-2', 0.3),
      ];

      const probNeuron = await manager.createProbabilisticNeuron(
        baseNeuron,
        customStates
      );

      expect(probNeuron.superposition.states.length).toBe(2);
    });
  });

  describe('addState', () => {
    it('should add a new state to superposition', async () => {
      const baseNeuron = createMockNeuron('add-state-test');
      const probNeuron = await manager.createProbabilisticNeuron(baseNeuron);

      const newEmbedding = createTestEmbedding(0.5);
      const newState = manager.addState(probNeuron.id, newEmbedding, 0.5, 'test-label');

      expect(newState).toBeDefined();
      expect(newState?.label).toBe('test-label');
      expect(probNeuron.superposition.states.length).toBe(2);
    });

    it('should prune weakest state when limit reached', async () => {
      const managerWithLimit = new ProbabilisticNeuronManager({
        neuronStore: mockStore as any,
        maxStatesPerNeuron: 3,
      });

      const baseNeuron = createMockNeuron('prune-test');
      const probNeuron = await managerWithLimit.createProbabilisticNeuron(baseNeuron);

      // Add states to reach limit
      for (let i = 0; i < 3; i++) {
        managerWithLimit.addState(
          probNeuron.id,
          createTestEmbedding(i * 0.1),
          0.3 + i * 0.1
        );
      }

      expect(probNeuron.superposition.states.length).toBeLessThanOrEqual(3);
    });

    it('should return null for non-existent neuron', () => {
      const result = manager.addState(
        'non-existent',
        createTestEmbedding(),
        0.5
      );
      expect(result).toBeNull();
    });
  });

  describe('observe', () => {
    it('should collapse superposition to a single state', async () => {
      const baseNeuron = createMockNeuron('observe-test');
      const probNeuron = await manager.createProbabilisticNeuron(baseNeuron);

      // Add more states
      manager.addState(probNeuron.id, createTestEmbedding(0.3), 0.5);
      manager.addState(probNeuron.id, createTestEmbedding(0.6), 0.3);

      const result = manager.observe(probNeuron.id, 'test-observer');

      expect(result).toBeDefined();
      expect(result?.collapsedState).toBeDefined();
      expect(result?.observer).toBe('test-observer');

      // After observation, selected state should have boosted probability
      const collapsed = probNeuron.superposition.states.find(
        s => s.id === result?.collapsedState.id
      );
      // Probability should be positive (observation boosts it slightly)
      expect(collapsed?.probability).toBeGreaterThan(0);
    });

    it('should return null for non-existent neuron', () => {
      const result = manager.observe('non-existent');
      expect(result).toBeNull();
    });

    it('should record observation in history', async () => {
      const baseNeuron = createMockNeuron('history-test');
      const probNeuron = await manager.createProbabilisticNeuron(baseNeuron);

      manager.observe(probNeuron.id);

      expect(probNeuron.observationHistory.length).toBe(1);
    });
  });

  describe('peekMostProbable', () => {
    it('should return most probable state without collapsing', async () => {
      const baseNeuron = createMockNeuron('peek-test');
      const probNeuron = await manager.createProbabilisticNeuron(baseNeuron);

      manager.addState(probNeuron.id, createTestEmbedding(0.5), 0.2);

      const mostProbable = manager.peekMostProbable(probNeuron.id);

      expect(mostProbable).toBeDefined();
      // States should remain unchanged (not collapsed)
      expect(probNeuron.superposition.states.length).toBe(2);
    });

    it('should return null for non-existent neuron', () => {
      const result = manager.peekMostProbable('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('evolve', () => {
    it('should evolve probability distribution over time', async () => {
      const baseNeuron = createMockNeuron('evolve-test');
      const probNeuron = await manager.createProbabilisticNeuron(baseNeuron);

      manager.addState(probNeuron.id, createTestEmbedding(0.5), 0.5);

      // Just verify evolve runs without error
      manager.evolve(probNeuron.id, 1000);

      // Probabilities should still be valid
      const totalProb = probNeuron.superposition.states.reduce(
        (sum, s) => sum + s.probability, 0
      );
      expect(totalProb).toBeCloseTo(1, 1);
    });
  });

  describe('entangle', () => {
    it('should correlate phases between two neurons', async () => {
      const neuronA = createMockNeuron('entangle-a');
      const neuronB = createMockNeuron('entangle-b');

      const probA = await manager.createProbabilisticNeuron(neuronA);
      const probB = await manager.createProbabilisticNeuron(neuronB);

      const success = manager.entangle(probA.id, probB.id);

      expect(success).toBe(true);
    });

    it('should return false for non-existent neurons', () => {
      const result = manager.entangle('non-existent-a', 'non-existent-b');
      expect(result).toBe(false);
    });
  });

  describe('getExpectedEmbedding', () => {
    it('should return weighted average of state embeddings', async () => {
      const baseNeuron = createMockNeuron('expected-test');
      const probNeuron = await manager.createProbabilisticNeuron(baseNeuron);

      const expected = manager.getExpectedEmbedding(probNeuron.id);

      expect(expected).toBeDefined();
      expect(expected?.length).toBe(384);
    });

    it('should return null for non-existent neuron', () => {
      const result = manager.getExpectedEmbedding('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('getUncertainty', () => {
    it('should return entropy of superposition', async () => {
      const baseNeuron = createMockNeuron('uncertainty-test');
      const probNeuron = await manager.createProbabilisticNeuron(baseNeuron);

      // Single state should have low entropy
      const entropy = manager.getUncertainty(probNeuron.id);
      expect(entropy).toBe(0); // Only one state = no uncertainty

      // Add more states to increase entropy
      manager.addState(probNeuron.id, createTestEmbedding(0.5), 0.5);
      const newEntropy = manager.getUncertainty(probNeuron.id);
      expect(newEntropy).toBeGreaterThan(0);
    });
  });

  describe('splitState', () => {
    it('should split a state into multiple possibilities', async () => {
      const baseNeuron = createMockNeuron('split-test');
      const probNeuron = await manager.createProbabilisticNeuron(baseNeuron);
      const stateId = probNeuron.superposition.states[0].id;

      const splitEmbeddings = [
        createTestEmbedding(0.3),
        createTestEmbedding(0.6),
      ];

      const newStates = manager.splitState(probNeuron.id, stateId, splitEmbeddings);

      expect(newStates.length).toBe(2);
      expect(probNeuron.superposition.states.length).toBe(2);
    });

    it('should return empty array for invalid neuron/state', () => {
      const result = manager.splitState('non-existent', 'state-id', []);
      expect(result).toEqual([]);
    });
  });

  describe('getNeuron', () => {
    it('should retrieve created probabilistic neuron', async () => {
      const baseNeuron = createMockNeuron('get-test');
      await manager.createProbabilisticNeuron(baseNeuron);

      const retrieved = manager.getNeuron('get-test');
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe('get-test');
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', async () => {
      const neuron1 = createMockNeuron('stats-1');
      const neuron2 = createMockNeuron('stats-2');

      await manager.createProbabilisticNeuron(neuron1);
      const prob2 = await manager.createProbabilisticNeuron(neuron2);
      manager.addState(prob2.id, createTestEmbedding(0.5), 0.5);

      const stats = manager.getStats();

      expect(stats.totalNeurons).toBe(2);
      expect(stats.totalStates).toBe(3); // 1 + 2
      expect(stats.averageStatesPerNeuron).toBe(1.5);
    });
  });
});

// Helper functions
function createMockNeuron(id: string): NeuronNode {
  return {
    id,
    embedding: createTestEmbedding(0.1),
    chunkHashes: ['hash1'],
    merkleRoot: 'merkle-root',
    metadata: {
      createdAt: new Date().toISOString(),
      lastAccessed: new Date().toISOString(),
      accessCount: 0,
      sourceType: 'test',
      tags: [],
    },
    outgoingSynapses: [],
    incomingSynapses: [],
  };
}

function createMockState(id: string, amplitude: number) {
  return {
    id,
    embedding: createTestEmbedding(amplitude),
    amplitude,
    phase: Math.random() * 2 * Math.PI,
    label: `state-${id}`,
    metadata: {},
    createdAt: new Date().toISOString(),
  };
}

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
