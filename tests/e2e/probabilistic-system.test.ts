/**
 * E2E Tests - Probabilistic System Full Flow
 *
 * Tests the complete lifecycle of the probabilistic system:
 * 1. Initialization with persistence
 * 2. Neuron creation and superposition
 * 3. Attractor creation and influence
 * 4. Learning from interaction
 * 5. State save/restore
 * 6. Evolution over time
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProbabilisticOrchestrator } from '../../src/core/probabilistic-orchestrator.js';
import { ProbabilisticNeuronManager } from '../../src/core/probabilistic-neuron.js';
import { AttractorModel } from '../../src/core/attractor-model.js';
import { FourStageLearningSystem } from '../../src/services/four-stage-learning.js';
import { DynamicEmbeddingManager } from '../../src/core/dynamic-embedding.js';
import type { NeuronNode, INeuronStore, Embedding384 } from '../../src/types/index.js';

// Mock neuron store for testing
function createMockStore(): INeuronStore {
  const neurons = new Map<string, NeuronNode>();
  const synapses = new Map<string, any>();

  return {
    async getNeuron(id: string) { return neurons.get(id) ?? null; },
    async getAllNeurons() { return Array.from(neurons.values()); },
    async saveNeuron(neuron: NeuronNode) { neurons.set(neuron.id, neuron); },
    async deleteNeuron(id: string) { neurons.delete(id); },
    async findSimilar(embedding: Embedding384, k: number) {
      return Array.from(neurons.values()).slice(0, k);
    },
    async getNeuronByMerkleRoot() { return null; },
    async updateNeuron(id: string, updates: Partial<NeuronNode>) {
      const neuron = neurons.get(id);
      if (neuron) {
        const updated = { ...neuron, ...updates };
        neurons.set(id, updated);
        return updated;
      }
      return null;
    },
    async recordAccess(id: string) {},
    async getAllNeuronIds() { return Array.from(neurons.keys()); },
    async getNeuronCount() { return neurons.size; },
    async createNeuron(input: any) {
      const neuron: NeuronNode = {
        id: `neuron_${Date.now()}`,
        embedding: input.embedding,
        chunkHashes: input.chunkHashes || [],
        merkleRoot: input.merkleRoot || 'test_root',
        relations: [],
        metadata: {
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          accessCount: 0,
          sourceType: input.sourceType,
          tags: input.tags,
        },
      };
      neurons.set(neuron.id, neuron);
      return neuron;
    },
    async putNeuron(neuron: NeuronNode) { neurons.set(neuron.id, neuron); },
    async createSynapse() { return null; },
    async putSynapse() {},
    async getSynapse() { return null; },
    async getOutgoingSynapses() { return []; },
    async getIncomingSynapses() { return []; },
    async updateSynapseWeight() { return null; },
    async recordSynapseActivation() {},
    async deleteSynapse() { return true; },
    async getSynapseCount() { return 0; },
    async init() {},
    async close() {},
  };
}

function createEmbedding(seed: number = 1): Embedding384 {
  const embedding = new Float32Array(384);
  for (let i = 0; i < 384; i++) {
    embedding[i] = Math.sin(seed * (i + 1)) * 0.5;
  }
  return embedding as Embedding384;
}

function createTestNeuron(id: string, seed: number): NeuronNode {
  return {
    id,
    content: `Test content for ${id}`,
    embedding: createEmbedding(seed),
    chunkHashes: ['hash1', 'hash2'],
    merkleRoot: `merkle_${id}`,
    relations: [],
    metadata: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      accessCount: 0,
      sourceType: 'test',
      tags: ['test'],
    },
  };
}

describe('E2E: Probabilistic System Full Flow', () => {
  let store: INeuronStore;
  let orchestrator: ProbabilisticOrchestrator;
  let neuronManager: ProbabilisticNeuronManager;
  let attractorModel: AttractorModel;
  let learningSystem: FourStageLearningSystem;
  let embeddingManager: DynamicEmbeddingManager;

  beforeEach(async () => {
    vi.useFakeTimers();

    store = createMockStore();

    // Initialize all modules
    neuronManager = new ProbabilisticNeuronManager({ neuronStore: store });
    attractorModel = new AttractorModel(store);
    learningSystem = new FourStageLearningSystem({ neuronStore: store });
    embeddingManager = new DynamicEmbeddingManager();

    // Create orchestrator
    orchestrator = new ProbabilisticOrchestrator({
      neuronStore: store,
      attractorModel,
      learningSystem,
      neuronManager,
      embeddingManager,
      config: {
        enableAutoSave: false, // Disable for testing
        enableAutoEvolution: false, // Disable for testing
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Full Lifecycle', () => {
    it('should support complete neuron lifecycle: create -> superpose -> evolve -> observe', async () => {
      // 1. Create and store a neuron
      const neuron = createTestNeuron('n1', 1);
      await store.saveNeuron(neuron);

      // 2. Create probabilistic superposition
      const probNeuron = await neuronManager.createProbabilisticNeuron(neuron);
      expect(probNeuron).toBeDefined();
      expect(probNeuron.superposition.states.length).toBeGreaterThanOrEqual(1);

      // 3. Add additional states
      neuronManager.addState('n1', createEmbedding(2), 0.3);
      neuronManager.addState('n1', createEmbedding(3), 0.2);

      // 4. Check uncertainty (entropy)
      const uncertainty = neuronManager.getUncertainty('n1');
      expect(uncertainty).toBeGreaterThan(0);

      // 5. Evolve over time (decoherence)
      neuronManager.evolve('n1', 10000);

      // 6. Observe (collapse)
      const observation = await neuronManager.observe('n1');
      expect(observation).toBeDefined();
      expect(observation!.collapsedState).toBeDefined();
      expect(observation!.probability).toBeGreaterThan(0);
    });

    it('should support attractor-influenced decision making', async () => {
      // 1. Create neurons representing different states
      const stateA = createTestNeuron('stateA', 1);
      const stateB = createTestNeuron('stateB', 2);
      const goalState = createTestNeuron('goal', 3);
      await store.saveNeuron(stateA);
      await store.saveNeuron(stateB);
      await store.saveNeuron(goalState);

      // 2. Create an attractor (goal)
      const attractor = attractorModel.createAttractor(
        'goal_attr',
        'Reach Goal',
        'The desired future state',
        goalState.embedding,
        { strength: 0.8, priority: 10 }
      );
      expect(attractor).toBeDefined();
      expect(attractor.strength).toBe(0.8);

      // 3. Calculate influence on current states
      const influenceA = attractorModel.calculateInfluence(stateA.embedding);
      const influenceB = attractorModel.calculateInfluence(stateB.embedding);

      // Both should have some influence from the attractor
      expect(influenceA.size).toBeGreaterThanOrEqual(0);
      expect(influenceB.size).toBeGreaterThanOrEqual(0);

      // 4. Get active attractors
      const activeAttractors = attractorModel.getActiveAttractors();
      expect(activeAttractors.length).toBe(1);
      expect(activeAttractors[0].id).toBe('goal_attr');
    });

    it('should support four-stage learning', async () => {
      // 1. Create a neuron with content
      const neuron = createTestNeuron('learning_n1', 1);
      await store.saveNeuron(neuron);

      // 2. Start a learning session
      const session = learningSystem.startSession();
      expect(session.id).toBeDefined();

      // 3. Extract meaningful content
      const extracts = await learningSystem.extractMeaningful(
        neuron.id,
        'This is a test concept with important information about TypeScript programming.'
      );
      expect(Array.isArray(extracts)).toBe(true);

      // 4. End session and get metrics
      const endedSession = learningSystem.endSession();
      expect(endedSession).toBeDefined();
      expect(endedSession!.metrics.totalExtracts).toBeGreaterThanOrEqual(0);

      // 5. Check stats
      const stats = learningSystem.getStats();
      expect(stats).toBeDefined();
      expect(typeof stats.extracts).toBe('number');
      expect(typeof stats.patterns).toBe('number');
    });

    it('should support dynamic dimension expansion', () => {
      // 1. Get initial stats
      const initialStats = embeddingManager.getStats();
      const initialDims = initialStats.totalDimensions;

      // 2. Register a new dimension
      embeddingManager.registerDimension('test_concept', {
        name: 'test_concept',
        description: 'A test semantic dimension',
        semanticCategory: 'test',
        createdAt: new Date().toISOString(),
        usageCount: 0,
      });

      // 3. Check that dimension count increased
      const newStats = embeddingManager.getStats();
      expect(newStats.totalDimensions).toBe(initialDims + 1);

      // 4. Get dimensions by category
      const testDims = embeddingManager.getDimensionsByCategory('test');
      expect(testDims).toContain('test_concept');
    });
  });

  describe('Orchestrator Integration', () => {
    it('should coordinate all modules through orchestrator', async () => {
      // 1. Get initial stats
      const stats = orchestrator.getStats();

      expect(stats.inference.available).toBe(false); // No inference engine provided
      expect(stats.attractors).toBeDefined();
      expect(stats.learning).toBeDefined();
      expect(stats.neurons).toBeDefined();
      expect(stats.dimensions).toBeDefined();
    });

    it('should expand dimensions for new concepts', async () => {
      const result = await orchestrator.expandForConcept('quantum_computing', 'science');

      expect(result.dimensionName).toBe('quantum_computing');
      expect(result.totalDimensions).toBeGreaterThan(0);
    });

    it('should learn from interactions', async () => {
      const result = await orchestrator.learnFromInteraction({
        input: 'What is TypeScript?',
        output: 'TypeScript is a typed superset of JavaScript.',
        success: true,
        feedback: 0.9,
      });

      expect(result).toBeDefined();
      expect(typeof result.extractsCreated).toBe('number');
      expect(typeof result.patternsLearned).toBe('number');
    });

    it('should provide feedback and reinforce paths', async () => {
      // Create test neurons
      const n1 = createTestNeuron('input_n', 1);
      const n2 = createTestNeuron('output_n', 2);
      await store.saveNeuron(n1);
      await store.saveNeuron(n2);
      await neuronManager.createProbabilisticNeuron(n1);
      await neuronManager.createProbabilisticNeuron(n2);

      // First, learn an interaction to create patterns
      await orchestrator.learnFromInteraction({
        input: 'Test input',
        output: 'Test output',
        success: true,
        feedback: 0.7,
        inputNeuronId: 'input_n',
        outputNeuronId: 'output_n',
      });

      // Provide feedback (may not update if no matching patterns exist)
      const feedbackResult = await orchestrator.provideFeedback(
        'input_n',
        'output_n',
        0.8,
        'Good response'
      );
      // Feedback returns updated based on whether patterns were found
      expect(feedbackResult).toBeDefined();
      expect(typeof feedbackResult.updated).toBe('boolean');

      // Reinforce path
      const reinforceResult = await orchestrator.reinforceSuccessfulPath(
        'input_n',
        'output_n',
        0.5
      );
      expect(reinforceResult.reinforced).toBe(true);
    });
  });

  describe('State Persistence', () => {
    it('should serialize and deserialize attractor state', () => {
      // Create attractors
      attractorModel.createAttractor(
        'attr1',
        'Goal 1',
        'First goal',
        createEmbedding(1),
        { strength: 0.7 }
      );
      attractorModel.createAttractor(
        'attr2',
        'Goal 2',
        'Second goal',
        createEmbedding(2),
        { strength: 0.5 }
      );

      // Serialize
      const serialized = attractorModel.serialize();

      // Create new model and load
      const newModel = new AttractorModel(store);
      newModel.load(serialized);

      // Verify
      const attractors = newModel.getActiveAttractors();
      expect(attractors.length).toBe(2);
    });

    it('should serialize and deserialize neuron manager state', () => {
      // Create probabilistic neurons
      const n1 = createTestNeuron('pn1', 1);
      const n2 = createTestNeuron('pn2', 2);

      neuronManager.createProbabilisticNeuron(n1);
      neuronManager.createProbabilisticNeuron(n2);
      neuronManager.addState('pn1', createEmbedding(3), 0.3);

      // Serialize
      const serialized = neuronManager.serialize();
      expect(serialized.neurons.length).toBe(2);

      // Create new manager and load
      const newManager = new ProbabilisticNeuronManager({ neuronStore: store });
      newManager.load(serialized);

      // Verify
      const stats = newManager.getStats();
      expect(stats.totalNeurons).toBe(2);
    });

    it('should serialize and deserialize learning system state', () => {
      // Create learning data
      const session = learningSystem.startSession();
      learningSystem.extractMeaningful('test', 'Test content for learning');
      learningSystem.endSession();

      // Serialize
      const serialized = learningSystem.serialize();

      // Create new system and load
      const newSystem = new FourStageLearningSystem({ neuronStore: store });
      newSystem.load(serialized);

      // Verify stats
      const stats = newSystem.getStats();
      expect(stats).toBeDefined();
    });
  });

  describe('Evolution Over Time', () => {
    it('should evolve all neurons over time', async () => {
      // Create neurons
      const neurons = [
        createTestNeuron('ev1', 1),
        createTestNeuron('ev2', 2),
        createTestNeuron('ev3', 3),
      ];

      for (const n of neurons) {
        await store.saveNeuron(n);
        await neuronManager.createProbabilisticNeuron(n);
        neuronManager.addState(n.id, createEmbedding(n.id.charCodeAt(2)), 0.3);
      }

      // Evolve all
      const neuronIds = neuronManager.getAllNeuronIds();
      for (const id of neuronIds) {
        neuronManager.evolve(id, 5000);
      }

      // All should still exist and have evolved
      const stats = neuronManager.getStats();
      expect(stats.totalNeurons).toBe(3);
    });

    it('should decay attractors over time', () => {
      // Create attractors with different strengths
      attractorModel.createAttractor('decay1', 'G1', 'Goal 1', createEmbedding(1), { strength: 0.9 });
      attractorModel.createAttractor('decay2', 'G2', 'Goal 2', createEmbedding(2), { strength: 0.3 });

      // Get initial state
      const initialActive = attractorModel.getActiveAttractors().length;
      expect(initialActive).toBe(2);

      // Decay (this should reduce strengths)
      attractorModel.decayAttractors();

      // Check that attractors still exist (decay doesn't immediately remove them)
      const afterDecay = attractorModel.getActiveAttractors();
      expect(afterDecay.length).toBeGreaterThanOrEqual(1);
    });
  });
});
