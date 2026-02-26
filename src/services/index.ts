/**
 * Services Layer Export
 * @module services
 *
 * NMT Services including:
 * - Original: IngestionService, QueryService, VerificationService
 * - Probabilistic Ontology: FourStageLearningSystem (4단계 학습)
 */

// Original Services
export * from './ingestion.js';
export * from './query.js';
export * from './verify.js';

// Probabilistic Ontology Extensions
export * from './four-stage-learning.js';

// Embedding Providers
export * from './embedding-provider.js';
export * from './text-embedding.js';
