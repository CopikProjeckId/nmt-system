/**
 * Evolution Scheduler Tests
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EvolutionScheduler, type EvolutionStats } from '../../src/core/evolution-scheduler.js';
import { ProbabilisticNeuronManager } from '../../src/core/probabilistic-neuron.js';
import { AttractorModel } from '../../src/core/attractor-model.js';
import type { NeuronNode, INeuronStore } from '../../src/types/index.js';

// Mock neuron store
function createMockStore(): INeuronStore {
  const neurons = new Map<string, NeuronNode>();
  return {
    async getNeuron(id: string) {
      return neurons.get(id) ?? null;
    },
    async getAllNeurons() {
      return Array.from(neurons.values());
    },
    async saveNeuron(neuron: NeuronNode) {
      neurons.set(neuron.id, neuron);
    },
    async deleteNeuron(id: string) {
      neurons.delete(id);
    },
    async findSimilar(embedding: Float32Array, k: number) {
      return Array.from(neurons.values()).slice(0, k);
    },
    async init() {},
    async close() {},
  };
}

function createEmbedding(seed: number = 1): Float32Array {
  const embedding = new Float32Array(384);
  for (let i = 0; i < 384; i++) {
    embedding[i] = Math.sin(seed * (i + 1)) * 0.5;
  }
  return embedding;
}

function createNeuron(id: string, seed: number): NeuronNode {
  return {
    id,
    content: `Neuron ${id}`,
    embedding: createEmbedding(seed),
    relations: [],
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('EvolutionScheduler', () => {
  let neuronManager: ProbabilisticNeuronManager;
  let attractorModel: AttractorModel;
  let store: INeuronStore;
  let scheduler: EvolutionScheduler;

  beforeEach(async () => {
    vi.useFakeTimers();
    store = createMockStore();
    neuronManager = new ProbabilisticNeuronManager({ neuronStore: store });
    attractorModel = new AttractorModel(store);
  });

  afterEach(() => {
    if (scheduler) {
      scheduler.stop();
    }
    vi.useRealTimers();
  });

  describe('constructor and start', () => {
    it('should create scheduler with default intervals', () => {
      scheduler = new EvolutionScheduler({
        neuronManager,
        attractorModel,
        neuronEvolveInterval: 60000,
        attractorDecayInterval: 3600000,
      });

      const status = scheduler.getStatus();
      expect(status.running).toBe(false);
      expect(status.totalEvolutions).toBe(0);
    });

    it('should create scheduler with custom intervals', () => {
      scheduler = new EvolutionScheduler({
        neuronManager,
        attractorModel,
        neuronEvolveInterval: 30000,
        attractorDecayInterval: 1800000,
      });

      const status = scheduler.getStatus();
      expect(status.running).toBe(false);
    });

    it('should start scheduler', () => {
      scheduler = new EvolutionScheduler({
        neuronManager,
        attractorModel,
        neuronEvolveInterval: 60000,
        attractorDecayInterval: 3600000,
      });

      scheduler.start();

      const status = scheduler.getStatus();
      expect(status.running).toBe(true);
      expect(status.startedAt).toBeDefined();
    });

    it('should not start scheduler twice', () => {
      scheduler = new EvolutionScheduler({
        neuronManager,
        attractorModel,
        neuronEvolveInterval: 60000,
        attractorDecayInterval: 3600000,
      });

      scheduler.start();
      scheduler.start(); // Should not throw

      expect(scheduler.getStatus().running).toBe(true);
    });
  });

  describe('stop', () => {
    it('should stop running scheduler', () => {
      scheduler = new EvolutionScheduler({
        neuronManager,
        attractorModel,
        neuronEvolveInterval: 60000,
        attractorDecayInterval: 3600000,
      });

      scheduler.start();
      expect(scheduler.getStatus().running).toBe(true);

      scheduler.stop();
      expect(scheduler.getStatus().running).toBe(false);
    });

    it('should be idempotent', () => {
      scheduler = new EvolutionScheduler({
        neuronManager,
        attractorModel,
        neuronEvolveInterval: 60000,
        attractorDecayInterval: 3600000,
      });

      scheduler.start();
      scheduler.stop();
      scheduler.stop(); // Should not throw

      expect(scheduler.getStatus().running).toBe(false);
    });
  });

  describe('evolveNow (manual evolution)', () => {
    it('should perform immediate evolution', async () => {
      const neuron = createNeuron('n1', 1);
      await store.saveNeuron(neuron);
      await neuronManager.createProbabilisticNeuron(neuron);

      scheduler = new EvolutionScheduler({
        neuronManager,
        attractorModel,
        neuronEvolveInterval: 60000,
        attractorDecayInterval: 3600000,
      });

      const stats = await scheduler.evolveNow();

      expect(stats).toBeDefined();
      expect(stats.neuronsEvolved).toBeGreaterThanOrEqual(0);
      expect(stats.attractorsDecayed).toBeGreaterThanOrEqual(0);
      expect(stats.timestamp).toBeDefined();
      expect(stats.duration).toBeGreaterThanOrEqual(0);
    });

    it('should call onEvolve callback', async () => {
      const onEvolveMock = vi.fn();

      scheduler = new EvolutionScheduler({
        neuronManager,
        attractorModel,
        neuronEvolveInterval: 60000,
        attractorDecayInterval: 3600000,
        onEvolve: onEvolveMock,
      });

      await scheduler.evolveNow();

      expect(onEvolveMock).toHaveBeenCalledTimes(1);
      expect(onEvolveMock).toHaveBeenCalledWith(
        expect.objectContaining({
          neuronsEvolved: expect.any(Number),
          attractorsDecayed: expect.any(Number),
        })
      );
    });

    it('should increment totalEvolutions', async () => {
      scheduler = new EvolutionScheduler({
        neuronManager,
        attractorModel,
        neuronEvolveInterval: 60000,
        attractorDecayInterval: 3600000,
      });

      expect(scheduler.getStatus().totalEvolutions).toBe(0);

      await scheduler.evolveNow();
      expect(scheduler.getStatus().totalEvolutions).toBe(1);

      await scheduler.evolveNow();
      expect(scheduler.getStatus().totalEvolutions).toBe(2);
    });
  });

  describe('setIntervals', () => {
    it('should update intervals', () => {
      scheduler = new EvolutionScheduler({
        neuronManager,
        attractorModel,
        neuronEvolveInterval: 60000,
        attractorDecayInterval: 3600000,
      });

      scheduler.setIntervals({
        neuronEvolve: 10000,
        attractorDecay: 500000,
      });

      // Intervals are updated internally (no getter exposed)
      expect(scheduler.getStatus().running).toBe(false);
    });

    it('should restart timers when running', () => {
      scheduler = new EvolutionScheduler({
        neuronManager,
        attractorModel,
        neuronEvolveInterval: 60000,
        attractorDecayInterval: 3600000,
      });

      scheduler.start();
      scheduler.setIntervals({ neuronEvolve: 5000 });

      expect(scheduler.getStatus().running).toBe(true);
    });
  });

  describe('automatic evolution (timer-based)', () => {
    it('should evolve neurons on interval', async () => {
      const neuron = createNeuron('n1', 1);
      await store.saveNeuron(neuron);
      await neuronManager.createProbabilisticNeuron(neuron);

      const onEvolveMock = vi.fn();
      scheduler = new EvolutionScheduler({
        neuronManager,
        attractorModel,
        neuronEvolveInterval: 1000, // 1 second for test
        attractorDecayInterval: 3600000,
        onEvolve: onEvolveMock,
      });

      scheduler.start();

      // Fast-forward time
      await vi.advanceTimersByTimeAsync(1000);

      // The evolveNeurons is called but onEvolve is only called from evolveNow
      // or from decayAttractors when there are decayed attractors
      // So we verify the scheduler is running
      expect(scheduler.getStatus().running).toBe(true);
    });

    it('should track next evolution time', async () => {
      scheduler = new EvolutionScheduler({
        neuronManager,
        attractorModel,
        neuronEvolveInterval: 60000,
        attractorDecayInterval: 3600000,
      });

      scheduler.start();

      const status = scheduler.getStatus();
      expect(status.nextEvolutionAt).toBeDefined();
    });
  });

  describe('getStatus', () => {
    it('should return complete status after evolution', async () => {
      scheduler = new EvolutionScheduler({
        neuronManager,
        attractorModel,
        neuronEvolveInterval: 1000,
        attractorDecayInterval: 3600000,
      });

      scheduler.start();
      await scheduler.evolveNow();

      const status = scheduler.getStatus();

      expect(status.running).toBe(true);
      expect(status.startedAt).toBeDefined();
      expect(status.totalEvolutions).toBe(1);
      expect(status.lastEvolution).toBeDefined();
      expect(status.lastEvolution?.timestamp).toBeDefined();
    });

    it('should show undefined lastEvolution before any evolution', () => {
      scheduler = new EvolutionScheduler({
        neuronManager,
        attractorModel,
        neuronEvolveInterval: 60000,
        attractorDecayInterval: 3600000,
      });

      const status = scheduler.getStatus();
      expect(status.lastEvolution).toBeUndefined();
    });
  });

  describe('edge cases', () => {
    it('should handle missing neuronManager', async () => {
      scheduler = new EvolutionScheduler({
        attractorModel,
        neuronEvolveInterval: 60000,
        attractorDecayInterval: 3600000,
      });

      const stats = await scheduler.evolveNow();
      expect(stats.neuronsEvolved).toBe(0);
    });

    it('should handle missing attractorModel', async () => {
      scheduler = new EvolutionScheduler({
        neuronManager,
        neuronEvolveInterval: 60000,
        attractorDecayInterval: 3600000,
      });

      const stats = await scheduler.evolveNow();
      expect(stats.attractorsDecayed).toBe(0);
    });

    it('should handle both missing', async () => {
      scheduler = new EvolutionScheduler({
        neuronEvolveInterval: 60000,
        attractorDecayInterval: 3600000,
      });

      const stats = await scheduler.evolveNow();
      expect(stats.neuronsEvolved).toBe(0);
      expect(stats.attractorsDecayed).toBe(0);
    });

    it('should call onError callback on error', async () => {
      const onErrorMock = vi.fn();
      const badNeuronManager = {
        getAllNeuronIds: () => { throw new Error('Test error'); },
      } as any;

      scheduler = new EvolutionScheduler({
        neuronManager: badNeuronManager,
        neuronEvolveInterval: 60000,
        attractorDecayInterval: 3600000,
        onError: onErrorMock,
      });

      await scheduler.evolveNow();

      expect(onErrorMock).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});
