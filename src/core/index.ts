/**
 * Core Module Export
 * @module core
 *
 * NMT Core Engines including:
 * - Original: ChunkEngine, MerkleEngine, HNSWIndex, NeuronGraphManager
 * - Probabilistic Ontology Extensions:
 *   - BidirectionalInferenceEngine (양방향 추론)
 *   - DynamicEmbeddingManager (동적 차원 확장)
 *   - AttractorModel (미래 끌개)
 *   - ProbabilisticNeuronManager (확률적 뉴런)
 */

// Original Core
export * from './chunk-engine.js';
export * from './merkle-engine.js';
export * from './hnsw-index.js';
export * from './neuron-graph.js';

// Probabilistic Ontology Extensions (확률적 존재론)
export * from './bidirectional-inference.js';
export * from './dynamic-embedding.js';
export * from './attractor-model.js';
export * from './probabilistic-neuron.js';
export * from './probabilistic-orchestrator.js';
export * from './evolution-scheduler.js';
