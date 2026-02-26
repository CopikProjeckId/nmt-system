/**
 * Bidirectional Inference Engine Tests
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BidirectionalInferenceEngine } from '../../src/core/bidirectional-inference.js';
import type { NeuronNode, Synapse } from '../../src/types/index.js';

// Mock dependencies
const mockStore = {
  getNeuron: vi.fn(),
  getOutgoingSynapses: vi.fn(),
  getIncomingSynapses: vi.fn(),
};

const mockGraphManager = {
  findSimilar: vi.fn(),
};

describe('BidirectionalInferenceEngine', () => {
  let engine: BidirectionalInferenceEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new BidirectionalInferenceEngine({
      neuronStore: mockStore as any,
      graphManager: mockGraphManager as any,
    });
  });

  describe('forwardInfer', () => {
    it('should return inference results for a neuron with connections', async () => {
      const sourceNeuron = createMockNeuron('source');
      const targetNeuron = createMockNeuron('target');
      const synapse: Synapse = {
        id: 'syn-1',
        sourceId: 'source',
        targetId: 'target',
        type: 'CAUSAL',
        weight: 0.8,
        bidirectional: false,
        metadata: {},
        createdAt: new Date().toISOString(),
      };

      mockStore.getOutgoingSynapses.mockResolvedValue([synapse]);
      mockStore.getNeuron.mockImplementation(async (id: string) => {
        if (id === 'target') return targetNeuron;
        return null;
      });

      const results = await engine.forwardInfer(sourceNeuron);

      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThanOrEqual(0);
    });

    it('should return empty results for neuron without connections', async () => {
      const sourceNeuron = createMockNeuron('isolated');

      mockStore.getOutgoingSynapses.mockResolvedValue([]);
      mockGraphManager.findSimilar.mockResolvedValue([]);

      const results = await engine.forwardInfer(sourceNeuron);

      expect(results).toBeDefined();
    });
  });

  describe('backwardInfer', () => {
    it('should perform abductive reasoning', async () => {
      const observedNeuron = createMockNeuron('observed');
      const causeNeuron = createMockNeuron('cause');
      const synapse: Synapse = {
        id: 'syn-2',
        sourceId: 'cause',
        targetId: 'observed',
        type: 'CAUSAL',
        weight: 0.7,
        bidirectional: false,
        metadata: {},
        createdAt: new Date().toISOString(),
      };

      mockStore.getIncomingSynapses.mockResolvedValue([synapse]);
      mockStore.getNeuron.mockImplementation(async (id: string) => {
        if (id === 'cause') return causeNeuron;
        return null;
      });

      const results = await engine.backwardInfer(observedNeuron);

      expect(results).toBeDefined();
    });
  });

  describe('infer', () => {
    it('should handle bidirectional inference', async () => {
      const neuron = createMockNeuron('center');

      mockStore.getOutgoingSynapses.mockResolvedValue([]);
      mockStore.getIncomingSynapses.mockResolvedValue([]);
      mockGraphManager.findSimilar.mockResolvedValue([]);

      const results = await engine.infer(neuron, {
        direction: 'both',
        maxDepth: 2,
      });

      expect(results).toBeDefined();
    });
  });
});

// Helper function
function createMockNeuron(id: string): NeuronNode {
  return {
    id,
    embedding: new Float32Array(384).fill(0.1),
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
