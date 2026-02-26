/**
 * Bidirectional Inference Engine - Forward and Backward (Abductive) Reasoning
 *
 * Based on Probabilistic Ontology Framework:
 * - Forward Inference: A → B (cause → effect)
 * - Backward Inference: B → A (effect → cause, abduction)
 * - Bidirectional: A ↔ B (full causal chain)
 *
 * @module core/bidirectional-inference
 */

import type {
  UUID,
  NeuronNode,
  Synapse,
  SynapseType,
  Embedding384,
  INeuronStore
} from '../types/index.js';
import { NeuronGraphManager } from './neuron-graph.js';
import { cosineSimilarity } from '../utils/similarity.js';
import { getMetrics, MetricNames } from '../utils/metrics.js';

/**
 * Inference direction
 */
export type InferenceDirection = 'forward' | 'backward' | 'bidirectional';

/**
 * Inference result
 */
export interface InferenceResult {
  direction: InferenceDirection;
  source: NeuronNode;
  target: NeuronNode | null;
  path: InferencePath[];
  confidence: number;
  explanation: string;
  timestamp: string;
}

/**
 * Single step in inference path
 */
export interface InferencePath {
  from: UUID;
  to: UUID;
  relation: SynapseType | 'INFERRED';
  weight: number;
  direction: 'forward' | 'backward';
  reasoning: string;
}

/**
 * Causal relation between concepts
 */
export interface CausalRelation {
  cause: UUID;
  effect: UUID;
  strength: number;
  evidence: UUID[];
  reversible: boolean;
  createdAt: string;
  activations: number;
}

/**
 * Abduction hypothesis
 */
export interface AbductionHypothesis {
  observation: UUID;
  hypothesis: UUID;
  plausibility: number;
  supportingEvidence: UUID[];
  contradictingEvidence: UUID[];
  explanation: string;
}

/**
 * Bidirectional Inference Engine Options
 */
export interface BidirectionalInferenceOptions {
  neuronStore: INeuronStore;
  graphManager: NeuronGraphManager;
  maxInferenceDepth?: number;
  minConfidenceThreshold?: number;
  enableAbduction?: boolean;
  causalDecayFactor?: number;
}

/**
 * Bidirectional Inference Engine
 *
 * Implements forward inference (A→B) and backward inference (B→A abduction)
 * based on probabilistic ontology principles.
 */
export class BidirectionalInferenceEngine {
  private store: INeuronStore;
  private graphManager: NeuronGraphManager;
  private maxDepth: number;
  private minConfidence: number;
  private enableAbduction: boolean;
  private decayFactor: number;

  // Causal knowledge base
  private causalRelations: Map<string, CausalRelation> = new Map();
  private abductionCache: Map<UUID, AbductionHypothesis[]> = new Map();

  constructor(options: BidirectionalInferenceOptions) {
    this.store = options.neuronStore;
    this.graphManager = options.graphManager;
    this.maxDepth = options.maxInferenceDepth ?? 5;
    this.minConfidence = options.minConfidenceThreshold ?? 0.3;
    this.enableAbduction = options.enableAbduction ?? true;
    this.decayFactor = options.causalDecayFactor ?? 0.85;
  }

  /**
   * Perform inference from source to find related concepts
   * @param sourceId - Starting neuron ID
   * @param direction - Inference direction
   * @param targetHint - Optional target embedding for guided search
   */
  async infer(
    sourceId: UUID,
    direction: InferenceDirection = 'bidirectional',
    targetHint?: Embedding384
  ): Promise<InferenceResult[]> {
    const metrics = getMetrics();
    const timer = metrics.startTimer(MetricNames.INFERENCE_DURATION_MS, { direction });
    metrics.increment(MetricNames.INFERENCE_REQUESTS, { direction });

    const source = await this.store.getNeuron(sourceId);
    if (!source) {
      timer();
      return [];
    }

    const results: InferenceResult[] = [];

    switch (direction) {
      case 'forward':
        results.push(...await this.forwardInfer(source, targetHint));
        break;
      case 'backward':
        results.push(...await this.backwardInfer(source, targetHint));
        break;
      case 'bidirectional':
        results.push(...await this.forwardInfer(source, targetHint));
        results.push(...await this.backwardInfer(source, targetHint));
        break;
    }

    // Sort by confidence
    results.sort((a, b) => b.confidence - a.confidence);

    timer();
    return results;
  }

  /**
   * Forward Inference: A → B (cause → effect)
   * "Given A, what effects/consequences follow?"
   */
  async forwardInfer(
    source: NeuronNode,
    targetHint?: Embedding384
  ): Promise<InferenceResult[]> {
    const results: InferenceResult[] = [];
    const visited = new Set<UUID>();
    visited.add(source.id);

    // Get outgoing causal/semantic connections
    const outgoing = await this.store.getOutgoingSynapses(source.id);

    for (const synapse of outgoing) {
      if (visited.has(synapse.targetId)) continue;

      const target = await this.store.getNeuron(synapse.targetId);
      if (!target) continue;

      // Calculate confidence based on synapse weight and type
      let confidence = synapse.weight;

      // Boost confidence for CAUSAL type
      if (synapse.type === 'CAUSAL') {
        confidence *= 1.2;
      }

      // If target hint provided, adjust confidence based on similarity
      if (targetHint) {
        const similarity = cosineSimilarity(target.embedding, targetHint);
        confidence *= (0.5 + similarity * 0.5);
      }

      if (confidence >= this.minConfidence) {
        results.push({
          direction: 'forward',
          source,
          target,
          path: [{
            from: source.id,
            to: target.id,
            relation: synapse.type,
            weight: synapse.weight,
            direction: 'forward',
            reasoning: `Direct ${synapse.type.toLowerCase()} connection`
          }],
          confidence: Math.min(1, confidence),
          explanation: this.generateForwardExplanation(source, target, synapse),
          timestamp: new Date().toISOString()
        });
      }

      visited.add(synapse.targetId);
    }

    // Multi-hop forward inference
    if (this.maxDepth > 1) {
      const multiHopResults = await this.multiHopForward(source, visited, 1, targetHint);
      results.push(...multiHopResults);
    }

    return results;
  }

  /**
   * Backward Inference (Abduction): B → A (effect → cause)
   * "Given B (observation), what could have caused it?"
   */
  async backwardInfer(
    observation: NeuronNode,
    targetHint?: Embedding384
  ): Promise<InferenceResult[]> {
    if (!this.enableAbduction) {
      return [];
    }

    const results: InferenceResult[] = [];
    const visited = new Set<UUID>();
    visited.add(observation.id);

    // Get incoming connections (things that point to this neuron)
    const incoming = await this.store.getIncomingSynapses(observation.id);

    for (const synapse of incoming) {
      if (visited.has(synapse.sourceId)) continue;

      const cause = await this.store.getNeuron(synapse.sourceId);
      if (!cause) continue;

      // Calculate abductive confidence
      // Backward inference typically has lower confidence than forward
      let confidence = synapse.weight * 0.8;

      // CAUSAL synapses are more reliable for abduction
      if (synapse.type === 'CAUSAL') {
        confidence *= 1.3;
      }

      // TEMPORAL synapses suggest temporal causation
      if (synapse.type === 'TEMPORAL') {
        confidence *= 1.1;
      }

      // If target hint provided, adjust confidence
      if (targetHint) {
        const similarity = cosineSimilarity(cause.embedding, targetHint);
        confidence *= (0.5 + similarity * 0.5);
      }

      if (confidence >= this.minConfidence) {
        const hypothesis: AbductionHypothesis = {
          observation: observation.id,
          hypothesis: cause.id,
          plausibility: confidence,
          supportingEvidence: [synapse.id],
          contradictingEvidence: [],
          explanation: this.generateAbductionExplanation(observation, cause, synapse)
        };

        // Cache the hypothesis
        this.cacheHypothesis(observation.id, hypothesis);

        results.push({
          direction: 'backward',
          source: observation,
          target: cause,
          path: [{
            from: observation.id,
            to: cause.id,
            relation: synapse.type,
            weight: synapse.weight,
            direction: 'backward',
            reasoning: `Abductive inference from ${synapse.type.toLowerCase()} relation`
          }],
          confidence: Math.min(1, confidence),
          explanation: hypothesis.explanation,
          timestamp: new Date().toISOString()
        });
      }

      visited.add(synapse.sourceId);
    }

    // Multi-hop backward inference
    if (this.maxDepth > 1) {
      const multiHopResults = await this.multiHopBackward(observation, visited, 1, targetHint);
      results.push(...multiHopResults);
    }

    return results;
  }

  /**
   * Find causal chain between two concepts
   * @param fromId - Starting concept
   * @param toId - Target concept
   */
  async findCausalChain(
    fromId: UUID,
    toId: UUID
  ): Promise<InferencePath[] | null> {
    const from = await this.store.getNeuron(fromId);
    const to = await this.store.getNeuron(toId);

    if (!from || !to) return null;

    // BFS to find shortest causal path
    const queue: Array<{ id: UUID; path: InferencePath[] }> = [
      { id: fromId, path: [] }
    ];
    const visited = new Set<UUID>();
    visited.add(fromId);

    while (queue.length > 0) {
      const { id, path } = queue.shift()!;

      if (id === toId) {
        return path;
      }

      if (path.length >= this.maxDepth) continue;

      // Try forward direction
      const outgoing = await this.store.getOutgoingSynapses(id);
      for (const synapse of outgoing) {
        if (visited.has(synapse.targetId)) continue;
        visited.add(synapse.targetId);

        const newPath: InferencePath = {
          from: id,
          to: synapse.targetId,
          relation: synapse.type,
          weight: synapse.weight,
          direction: 'forward',
          reasoning: `Forward via ${synapse.type}`
        };

        queue.push({
          id: synapse.targetId,
          path: [...path, newPath]
        });
      }

      // Try backward direction (for bidirectional search)
      const incoming = await this.store.getIncomingSynapses(id);
      for (const synapse of incoming) {
        if (visited.has(synapse.sourceId)) continue;
        visited.add(synapse.sourceId);

        const newPath: InferencePath = {
          from: id,
          to: synapse.sourceId,
          relation: synapse.type,
          weight: synapse.weight,
          direction: 'backward',
          reasoning: `Backward via ${synapse.type}`
        };

        queue.push({
          id: synapse.sourceId,
          path: [...path, newPath]
        });
      }
    }

    return null;
  }

  /**
   * Register a causal relation for learning
   */
  registerCausalRelation(
    causeId: UUID,
    effectId: UUID,
    strength: number,
    evidence: UUID[] = []
  ): void {
    const key = `${causeId}:${effectId}`;

    const existing = this.causalRelations.get(key);
    if (existing) {
      // Update existing relation
      existing.strength = (existing.strength + strength) / 2;
      existing.evidence.push(...evidence);
      existing.activations++;
    } else {
      // Create new relation
      this.causalRelations.set(key, {
        cause: causeId,
        effect: effectId,
        strength,
        evidence,
        reversible: false,
        createdAt: new Date().toISOString(),
        activations: 1
      });
    }
  }

  /**
   * Get abduction hypotheses for an observation
   */
  getHypotheses(observationId: UUID): AbductionHypothesis[] {
    return this.abductionCache.get(observationId) ?? [];
  }

  /**
   * Validate a hypothesis by checking supporting evidence
   */
  async validateHypothesis(hypothesis: AbductionHypothesis): Promise<number> {
    let supportScore = 0;
    let contradictScore = 0;

    // Check supporting evidence
    for (const evidenceId of hypothesis.supportingEvidence) {
      const synapse = await this.store.getSynapse(evidenceId);
      if (synapse) {
        supportScore += synapse.weight;
      }
    }

    // Check contradicting evidence
    for (const evidenceId of hypothesis.contradictingEvidence) {
      const synapse = await this.store.getSynapse(evidenceId);
      if (synapse) {
        contradictScore += synapse.weight;
      }
    }

    // Calculate validation score
    const total = supportScore + contradictScore;
    if (total === 0) return hypothesis.plausibility;

    return (supportScore / total) * hypothesis.plausibility;
  }

  /**
   * Get inference statistics
   */
  getStats(): {
    causalRelations: number;
    cachedHypotheses: number;
    averageCausalStrength: number;
  } {
    let totalStrength = 0;
    for (const relation of this.causalRelations.values()) {
      totalStrength += relation.strength;
    }

    let totalHypotheses = 0;
    for (const hypotheses of this.abductionCache.values()) {
      totalHypotheses += hypotheses.length;
    }

    return {
      causalRelations: this.causalRelations.size,
      cachedHypotheses: totalHypotheses,
      averageCausalStrength: this.causalRelations.size > 0
        ? totalStrength / this.causalRelations.size
        : 0
    };
  }

  // ==================== Private Methods ====================

  private async multiHopForward(
    source: NeuronNode,
    visited: Set<UUID>,
    depth: number,
    targetHint?: Embedding384
  ): Promise<InferenceResult[]> {
    if (depth >= this.maxDepth) return [];

    const results: InferenceResult[] = [];
    const outgoing = await this.store.getOutgoingSynapses(source.id);

    for (const synapse of outgoing) {
      if (visited.has(synapse.targetId)) continue;

      const intermediate = await this.store.getNeuron(synapse.targetId);
      if (!intermediate) continue;

      visited.add(synapse.targetId);

      // Get next hop connections
      const nextOutgoing = await this.store.getOutgoingSynapses(intermediate.id);

      for (const nextSynapse of nextOutgoing) {
        if (visited.has(nextSynapse.targetId)) continue;

        const target = await this.store.getNeuron(nextSynapse.targetId);
        if (!target) continue;

        // Calculate multi-hop confidence with decay
        let confidence = synapse.weight * nextSynapse.weight * Math.pow(this.decayFactor, depth);

        if (targetHint) {
          const similarity = cosineSimilarity(target.embedding, targetHint);
          confidence *= (0.5 + similarity * 0.5);
        }

        if (confidence >= this.minConfidence) {
          results.push({
            direction: 'forward',
            source,
            target,
            path: [
              {
                from: source.id,
                to: intermediate.id,
                relation: synapse.type,
                weight: synapse.weight,
                direction: 'forward',
                reasoning: `Hop ${depth}: ${synapse.type}`
              },
              {
                from: intermediate.id,
                to: target.id,
                relation: nextSynapse.type,
                weight: nextSynapse.weight,
                direction: 'forward',
                reasoning: `Hop ${depth + 1}: ${nextSynapse.type}`
              }
            ],
            confidence: Math.min(1, confidence),
            explanation: `Multi-hop forward inference through ${depth + 1} connections`,
            timestamp: new Date().toISOString()
          });
        }

        visited.add(nextSynapse.targetId);
      }
    }

    return results;
  }

  private async multiHopBackward(
    observation: NeuronNode,
    visited: Set<UUID>,
    depth: number,
    targetHint?: Embedding384
  ): Promise<InferenceResult[]> {
    if (depth >= this.maxDepth) return [];

    const results: InferenceResult[] = [];
    const incoming = await this.store.getIncomingSynapses(observation.id);

    for (const synapse of incoming) {
      if (visited.has(synapse.sourceId)) continue;

      const intermediate = await this.store.getNeuron(synapse.sourceId);
      if (!intermediate) continue;

      visited.add(synapse.sourceId);

      // Get previous hop connections
      const prevIncoming = await this.store.getIncomingSynapses(intermediate.id);

      for (const prevSynapse of prevIncoming) {
        if (visited.has(prevSynapse.sourceId)) continue;

        const cause = await this.store.getNeuron(prevSynapse.sourceId);
        if (!cause) continue;

        // Calculate multi-hop abductive confidence with higher decay
        let confidence = synapse.weight * prevSynapse.weight * Math.pow(this.decayFactor * 0.9, depth);

        if (targetHint) {
          const similarity = cosineSimilarity(cause.embedding, targetHint);
          confidence *= (0.5 + similarity * 0.5);
        }

        if (confidence >= this.minConfidence) {
          results.push({
            direction: 'backward',
            source: observation,
            target: cause,
            path: [
              {
                from: observation.id,
                to: intermediate.id,
                relation: synapse.type,
                weight: synapse.weight,
                direction: 'backward',
                reasoning: `Abductive hop ${depth}: ${synapse.type}`
              },
              {
                from: intermediate.id,
                to: cause.id,
                relation: prevSynapse.type,
                weight: prevSynapse.weight,
                direction: 'backward',
                reasoning: `Abductive hop ${depth + 1}: ${prevSynapse.type}`
              }
            ],
            confidence: Math.min(1, confidence),
            explanation: `Multi-hop abductive inference: potential root cause ${depth + 1} steps back`,
            timestamp: new Date().toISOString()
          });
        }

        visited.add(prevSynapse.sourceId);
      }
    }

    return results;
  }

  private generateForwardExplanation(
    source: NeuronNode,
    target: NeuronNode,
    synapse: Synapse
  ): string {
    const sourceDesc = source.metadata.tags.length > 0
      ? source.metadata.tags.join(', ')
      : source.id.substring(0, 8);
    const targetDesc = target.metadata.tags.length > 0
      ? target.metadata.tags.join(', ')
      : target.id.substring(0, 8);

    switch (synapse.type) {
      case 'CAUSAL':
        return `[${sourceDesc}] causes [${targetDesc}] (strength: ${synapse.weight.toFixed(2)})`;
      case 'TEMPORAL':
        return `[${sourceDesc}] precedes [${targetDesc}] temporally`;
      case 'SEMANTIC':
        return `[${sourceDesc}] is semantically related to [${targetDesc}]`;
      default:
        return `[${sourceDesc}] → [${targetDesc}] via ${synapse.type}`;
    }
  }

  private generateAbductionExplanation(
    observation: NeuronNode,
    cause: NeuronNode,
    synapse: Synapse
  ): string {
    const obsDesc = observation.metadata.tags.length > 0
      ? observation.metadata.tags.join(', ')
      : observation.id.substring(0, 8);
    const causeDesc = cause.metadata.tags.length > 0
      ? cause.metadata.tags.join(', ')
      : cause.id.substring(0, 8);

    return `Hypothesis: [${causeDesc}] may have caused [${obsDesc}] ` +
           `(plausibility: ${(synapse.weight * 0.8).toFixed(2)}, ` +
           `based on ${synapse.type.toLowerCase()} relation)`;
  }

  private cacheHypothesis(observationId: UUID, hypothesis: AbductionHypothesis): void {
    const existing = this.abductionCache.get(observationId) ?? [];

    // Check for duplicate hypothesis
    const isDuplicate = existing.some(h => h.hypothesis === hypothesis.hypothesis);
    if (!isDuplicate) {
      existing.push(hypothesis);
      this.abductionCache.set(observationId, existing);
    }
  }
}

/**
 * Create a BidirectionalInferenceEngine instance
 */
export function createBidirectionalInferenceEngine(
  options: BidirectionalInferenceOptions
): BidirectionalInferenceEngine {
  return new BidirectionalInferenceEngine(options);
}
