/**
 * Probabilistic Orchestrator Integration Tests
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProbabilisticOrchestrator } from '../../src/core/probabilistic-orchestrator.js';
import { BidirectionalInferenceEngine } from '../../src/core/bidirectional-inference.js';
import { AttractorModel } from '../../src/core/attractor-model.js';
import { ProbabilisticNeuronManager } from '../../src/core/probabilistic-neuron.js';
import { DynamicEmbeddingManager } from '../../src/core/dynamic-embedding.js';
import type { NeuronNode, Synapse } from '../../src/types/index.js';

// Mock neuron store
const createMockStore = () => ({
  getNeuron: vi.fn(),
  getOutgoingSynapses: vi.fn(),
  getIncomingSynapses: vi.fn(),
  findSimilar: vi.fn().mockResolvedValue([]),
  getAllNeurons: vi.fn().mockResolvedValue([]),
  saveNeuron: vi.fn().mockResolvedValue(undefined),
  deleteNeuron: vi.fn().mockResolvedValue(undefined),
});

describe('ProbabilisticOrchestrator Integration', () => {
  let orchestrator: ProbabilisticOrchestrator;
  let mockStore: ReturnType<typeof createMockStore>;
  let inferenceEngine: BidirectionalInferenceEngine;
  let attractorModel: AttractorModel;
  let neuronManager: ProbabilisticNeuronManager;
  let embeddingManager: DynamicEmbeddingManager;

  beforeEach(() => {
    vi.clearAllMocks();

    mockStore = createMockStore();

    // Initialize all modules
    inferenceEngine = new BidirectionalInferenceEngine({
      neuronStore: mockStore as any,
      graphManager: { findSimilar: vi.fn().mockResolvedValue([]) } as any,
    });

    attractorModel = new AttractorModel({
      neuronStore: mockStore as any,
      maxAttractors: 10,
    });

    neuronManager = new ProbabilisticNeuronManager({
      neuronStore: mockStore as any,
      maxStatesPerNeuron: 10,
    });

    embeddingManager = new DynamicEmbeddingManager({
      baseDimension: 384,
      maxDimensions: 1000,
    });

    orchestrator = new ProbabilisticOrchestrator({
      neuronStore: mockStore as any,
      inferenceEngine,
      attractorModel,
      neuronManager,
      embeddingManager,
    });
  });

  describe('unifiedInfer', () => {
    it('should combine inference from all modules', async () => {
      const neuron = createMockNeuron('test-neuron');
      const targetNeuron = createMockNeuron('target-neuron');

      mockStore.getNeuron.mockImplementation(async (id: string) => {
        if (id === 'test-neuron') return neuron;
        if (id === 'target-neuron') return targetNeuron;
        return null;
      });

      const synapse: Synapse = {
        id: 'syn-1',
        sourceId: 'test-neuron',
        targetId: 'target-neuron',
        type: 'CAUSAL',
        weight: 0.8,
        bidirectional: false,
        metadata: {},
        createdAt: new Date().toISOString(),
      };

      mockStore.getOutgoingSynapses.mockResolvedValue([synapse]);
      mockStore.getIncomingSynapses.mockResolvedValue([]);

      // Create attractor
      const attractorEmbedding = createTestEmbedding(0.5);
      attractorModel.createAttractor('goal-1', 'Test Goal', 'desc', attractorEmbedding);

      // Create probabilistic neuron
      await neuronManager.createProbabilisticNeuron(neuron);

      const result = await orchestrator.unifiedInfer('test-neuron', {
        includeAttractors: true,
        includeProbabilistic: true,
      });

      expect(result).toBeDefined();
      expect(result.forwardPaths).toBeDefined();
      expect(result.backwardPaths).toBeDefined();
      expect(result.attractorInfluences).toBeDefined();
      expect(result.stateDistribution).toBeDefined();
    });

    it('should return empty result for non-existent neuron', async () => {
      mockStore.getNeuron.mockResolvedValue(null);

      const result = await orchestrator.unifiedInfer('non-existent');

      expect(result.forwardPaths).toEqual([]);
      expect(result.backwardPaths).toEqual([]);
      expect(result.recommendations).toEqual([]);
    });
  });

  describe('learnFromInteraction', () => {
    it('should update modules based on interaction', async () => {
      const result = await orchestrator.learnFromInteraction({
        input: 'test input',
        output: 'test output',
        success: true,
        feedback: 0.8,
      });

      expect(result).toBeDefined();
      expect(result.patternsLearned).toBeDefined();
      expect(result.attractorsUpdated).toBeDefined();
      expect(result.neuronsUpdated).toBeDefined();
      expect(result.extractsCreated).toBeDefined();
      expect(result.processLearned).toBeDefined();
      expect(result.outcomeRecorded).toBeDefined();
    });

    it('should learn with provided neuron IDs', async () => {
      const inputNeuron = createMockNeuron('input-neuron');
      const outputNeuron = createMockNeuron('output-neuron');
      mockStore.getNeuron
        .mockResolvedValueOnce(inputNeuron)
        .mockResolvedValueOnce(outputNeuron);

      const result = await orchestrator.learnFromInteraction({
        input: 'test query',
        output: 'test response',
        success: true,
        feedback: 0.9,
        inputNeuronId: 'input-neuron',
        outputNeuronId: 'output-neuron',
      });

      expect(result.inputNeuronId).toBe('input-neuron');
      expect(result.outputNeuronId).toBe('output-neuron');
    });
  });

  describe('provideFeedback', () => {
    it('should return false without learning system', async () => {
      const minimalOrchestrator = new ProbabilisticOrchestrator({
        neuronStore: mockStore as any,
      });

      const result = await minimalOrchestrator.provideFeedback(
        'input-id',
        'output-id',
        0.9
      );

      expect(result.updated).toBe(false);
    });
  });

  describe('reinforceSuccessfulPath', () => {
    it('should reinforce path between neurons', async () => {
      const fromNeuron = createMockNeuron('from-neuron');
      const toNeuron = createMockNeuron('to-neuron');
      mockStore.getNeuron
        .mockResolvedValueOnce(fromNeuron)
        .mockResolvedValueOnce(toNeuron);

      const result = await orchestrator.reinforceSuccessfulPath(
        'from-neuron',
        'to-neuron',
        0.2
      );

      expect(result.reinforced).toBe(true);
    });
  });

  describe('createGoalDrivenNeuron', () => {
    it('should create probabilistic neuron toward attractor', async () => {
      const neuron = createMockNeuron('base-neuron');
      mockStore.getNeuron.mockResolvedValue(neuron);
      mockStore.getOutgoingSynapses.mockResolvedValue([]);

      const attractorEmbedding = createTestEmbedding(0.5);
      attractorModel.createAttractor('goal-1', 'Goal', 'desc', attractorEmbedding);

      const result = await orchestrator.createGoalDrivenNeuron('base-neuron', 'goal-1');

      expect(result).toBeDefined();
      expect(result?.neuronId).toBe('base-neuron');
      expect(result?.initialState).toBe(0);
    });

    it('should return null without required modules', async () => {
      const minimalOrchestrator = new ProbabilisticOrchestrator({
        neuronStore: mockStore as any,
      });

      const result = await minimalOrchestrator.createGoalDrivenNeuron('id', 'goal');

      expect(result).toBeNull();
    });
  });

  describe('expandForConcept', () => {
    it('should register new dimension for concept', async () => {
      const result = await orchestrator.expandForConcept('quantum_computing', 'science');

      expect(result.dimensionName).toBe('quantum_computing');
      expect(result.totalDimensions).toBeGreaterThan(384);
    });

    it('should work without embedding manager', async () => {
      const minimalOrchestrator = new ProbabilisticOrchestrator({
        neuronStore: mockStore as any,
      });

      const result = await minimalOrchestrator.expandForConcept('concept', 'cat');

      expect(result.dimensionName).toBe('concept');
      expect(result.totalDimensions).toBe(384);
    });
  });

  describe('getStats', () => {
    it('should return comprehensive statistics', async () => {
      // Add some data to modules
      const neuron = createMockNeuron('stats-neuron');
      await neuronManager.createProbabilisticNeuron(neuron);

      const attractorEmbedding = createTestEmbedding(0.5);
      attractorModel.createAttractor('att-1', 'Attractor', 'desc', attractorEmbedding);

      const stats = orchestrator.getStats();

      expect(stats.inference.available).toBe(true);
      expect(stats.attractors.count).toBe(1);
      expect(stats.neurons.count).toBe(1);
      expect(stats.dimensions.total).toBe(384);
    });

    it('should handle missing modules gracefully', () => {
      const minimalOrchestrator = new ProbabilisticOrchestrator({
        neuronStore: mockStore as any,
      });

      const stats = minimalOrchestrator.getStats();

      expect(stats.inference.available).toBe(false);
      expect(stats.attractors.count).toBe(0);
      expect(stats.neurons.count).toBe(0);
    });
  });
});

describe('Module Coordination', () => {
  it('should coordinate attractor influence with inference', async () => {
    const mockStore = createMockStore();

    const neuron1 = createMockNeuron('n1');
    const neuron2 = createMockNeuron('n2');

    mockStore.getNeuron.mockImplementation(async (id: string) => {
      if (id === 'n1') return neuron1;
      if (id === 'n2') return neuron2;
      return null;
    });

    mockStore.getOutgoingSynapses.mockResolvedValue([
      {
        id: 'syn-1',
        sourceId: 'n1',
        targetId: 'n2',
        type: 'CAUSAL',
        weight: 0.7,
        bidirectional: false,
        metadata: {},
        createdAt: new Date().toISOString(),
      },
    ]);
    mockStore.getIncomingSynapses.mockResolvedValue([]);

    const attractorModel = new AttractorModel({
      neuronStore: mockStore as any,
    });

    // Create attractor near n2's embedding
    const attractorEmbedding = createTestEmbedding(0.1);
    attractorModel.createAttractor('goal', 'Goal', 'desc', attractorEmbedding, {
      strength: 0.9,
      priority: 8,
    });

    const inferenceEngine = new BidirectionalInferenceEngine({
      neuronStore: mockStore as any,
      graphManager: { findSimilar: vi.fn().mockResolvedValue([]) } as any,
    });

    const orchestrator = new ProbabilisticOrchestrator({
      neuronStore: mockStore as any,
      inferenceEngine,
      attractorModel,
    });

    const result = await orchestrator.unifiedInfer('n1', {
      includeAttractors: true,
    });

    expect(result.attractorInfluences.size).toBeGreaterThan(0);
  });

  it('should coordinate dynamic embeddings with probabilistic neurons', async () => {
    const mockStore = createMockStore();

    const embeddingManager = new DynamicEmbeddingManager({
      baseDimension: 384,
    });

    const neuronManager = new ProbabilisticNeuronManager({
      neuronStore: mockStore as any,
    });

    const neuron = createMockNeuron('coord-test');
    mockStore.getNeuron.mockResolvedValue(neuron);

    // Create dynamic embedding
    embeddingManager.createFromFixed('coord-test', neuron.embedding);

    // Create probabilistic neuron
    const probNeuron = await neuronManager.createProbabilisticNeuron(neuron);

    // Add states based on expanded embeddings
    embeddingManager.registerDimension('extended_concept', {
      name: 'extended_concept',
      description: 'Test extended dimension',
      createdAt: new Date().toISOString(),
      semanticCategory: 'test',
      usageCount: 0,
    });

    const newEmbedding = createTestEmbedding(0.5);
    neuronManager.addState(probNeuron.id, newEmbedding, 0.4, 'extended');

    expect(probNeuron.superposition.states.length).toBe(2);
    expect(embeddingManager.getCurrentDimensionCount()).toBe(385);
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
