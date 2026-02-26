/**
 * Probabilistic Neuron System - Direct Probability Distribution
 *
 * Clean implementation without quantum simulation overhead:
 * - Direct probability distributions over interpretations
 * - Shannon entropy for uncertainty
 * - Bayesian updates for evidence
 * - Simple, fast, interpretable
 *
 * @module core/probabilistic-neuron
 */

import type {
  UUID,
  NeuronNode,
  Embedding384,
  INeuronStore
} from '../types/index.js';
import { cosineSimilarity } from '../utils/similarity.js';
import { generateUUID } from '../utils/uuid.js';

/**
 * A single possible interpretation/state
 */
export interface NeuronState {
  id: UUID;
  embedding: Embedding384;
  probability: number;       // Direct probability (0-1)
  label?: string;
  metadata: Record<string, any>;
  createdAt: string;
}

/**
 * Probability distribution over multiple states
 */
export interface StateSuperposition {
  states: NeuronState[];
  entropy: number;            // Shannon entropy (bits)
  dominantState: UUID | null;
  lastObserved?: string;
}

/**
 * Observation result after selection
 */
export interface ObservationResult {
  neuronId: UUID;
  collapsedState: NeuronState;
  probability: number;
  previousEntropy: number;
  newEntropy: number;
  observedAt: string;
  observer?: string;
}

/**
 * State evolution record
 */
export interface StateEvolution {
  neuronId: UUID;
  fromState: UUID;
  toState: UUID;
  probability: number;
  trigger: string;
  timestamp: string;
}

/**
 * Probabilistic Neuron
 */
export interface ProbabilisticNeuron extends NeuronNode {
  superposition: StateSuperposition;
  observationHistory: ObservationResult[];
  decayRate: number;          // Rate at which distribution flattens
}

/**
 * Probabilistic Neuron Manager Options
 */
export interface ProbabilisticNeuronOptions {
  neuronStore: INeuronStore;
  maxStatesPerNeuron?: number;
  defaultDecayRate?: number;
  enableInterference?: boolean;
}

/**
 * State distribution info for external access
 */
export interface StateDistributionInfo {
  neuronId: UUID;
  dimension: number;
  amplitudes: Array<{ re: number; im: number; magnitude: number; phase: number }>; // Legacy compat
  probabilities: number[];
  entropy: number;
  purity: number;
  isEntangled: boolean;  // Actually: isCorrelated
  entangledWith?: UUID[]; // Actually: correlatedWith
}

/** @deprecated Use StateDistributionInfo instead */
export type QuantumStateInfo = StateDistributionInfo;

/**
 * Entanglement info (correlation between neurons)
 */
export interface EntanglementInfo {
  concurrence: number;
  vonNeumannEntropy: number;
  bellState: 'Φ+' | 'Φ-' | 'Ψ+' | 'Ψ-' | 'mixed' | null;
}

/**
 * Probabilistic Neuron Manager - Direct Probability Distribution
 *
 * Manages neurons with probability distributions over interpretations.
 * No quantum overhead - just clean Bayesian probability.
 *
 * Key Concepts:
 * - **Distribution**: Each neuron has multiple possible interpretations with probabilities
 * - **Observation**: Samples from distribution, can update based on context
 * - **Entropy**: Shannon entropy measures uncertainty
 * - **Correlation**: Similar embeddings can have correlated updates
 *
 * @example
 * ```typescript
 * const manager = new ProbabilisticNeuronManager({ neuronStore: store });
 *
 * // Create a probabilistic neuron
 * const probNeuron = await manager.createProbabilisticNeuron(classicalNeuron);
 *
 * // Add alternative interpretation
 * manager.addState(probNeuron.id, alternativeEmbedding, 0.3, 'alternative');
 *
 * // Check uncertainty (entropy)
 * const uncertainty = manager.getUncertainty(probNeuron.id);
 * console.log(`Uncertainty: ${uncertainty.toFixed(2)} bits`);
 *
 * // Observe to sample from distribution
 * const result = manager.observe(probNeuron.id, 'user-query');
 * console.log(`Selected: ${result?.collapsedState.label}`);
 * ```
 */
export class ProbabilisticNeuronManager {
  private store: INeuronStore;
  private maxStates: number;
  private defaultDecayRate: number;
  private interferenceEnabled: boolean;

  // Storage
  private probabilisticNeurons: Map<UUID, ProbabilisticNeuron> = new Map();
  private evolutionHistory: StateEvolution[] = [];

  // Correlation tracking (replacement for "entanglement")
  private correlationPairs: Map<UUID, Set<UUID>> = new Map();

  constructor(options: ProbabilisticNeuronOptions) {
    this.store = options.neuronStore;
    this.maxStates = options.maxStatesPerNeuron ?? 10;
    this.defaultDecayRate = options.defaultDecayRate ?? 0.01;
    this.interferenceEnabled = options.enableInterference ?? true;
  }

  /**
   * Create a probabilistic neuron from a classical neuron.
   */
  async createProbabilisticNeuron(
    baseNeuron: NeuronNode,
    initialStates?: NeuronState[]
  ): Promise<ProbabilisticNeuron> {
    const states = initialStates ?? [this.createStateFromNeuron(baseNeuron, 1.0)];

    const superposition: StateSuperposition = {
      states,
      entropy: this.calculateEntropy(states),
      dominantState: states.length > 0 ? states[0].id : null
    };

    const probNeuron: ProbabilisticNeuron = {
      ...baseNeuron,
      superposition,
      observationHistory: [],
      decayRate: this.defaultDecayRate
    };

    this.probabilisticNeurons.set(probNeuron.id, probNeuron);
    return probNeuron;
  }

  /**
   * Add a new state to neuron's distribution.
   */
  addState(
    neuronId: UUID,
    embedding: Embedding384,
    probability: number,
    label?: string,
    metadata?: Record<string, any>
  ): NeuronState | null {
    const neuron = this.probabilisticNeurons.get(neuronId);
    if (!neuron) return null;

    if (neuron.superposition.states.length >= this.maxStates) {
      this.pruneWeakestState(neuron);
    }

    const state: NeuronState = {
      id: generateUUID(),
      embedding,
      probability: Math.min(1, Math.max(0, probability)),
      label,
      metadata: metadata ?? {},
      createdAt: new Date().toISOString()
    };

    neuron.superposition.states.push(state);
    this.normalizeProbabilities(neuron);
    this.updateMetrics(neuron);

    return state;
  }

  /**
   * Observe the neuron - sample from probability distribution.
   *
   * Uses direct probability sampling:
   * P(state_i) = probability_i / Σ probabilities
   */
  observe(
    neuronId: UUID,
    observer?: string,
    biasEmbedding?: Embedding384
  ): ObservationResult | null {
    const neuron = this.probabilisticNeurons.get(neuronId);
    if (!neuron) return null;

    const previousEntropy = neuron.superposition.entropy;

    // Calculate biased probabilities
    const probabilities = this.calculateBiasedProbabilities(neuron, biasEmbedding);

    // Sample from distribution
    const selectedState = this.sampleFromDistribution(
      neuron.superposition.states,
      probabilities
    );

    if (!selectedState) return null;

    // Update distribution (increase selected, decrease others)
    this.updateAfterObservation(neuron, selectedState, 0.1);

    // Handle correlated neurons
    const correlatedPartners = this.correlationPairs.get(neuronId);
    if (correlatedPartners) {
      for (const partnerId of correlatedPartners) {
        this.handleCorrelatedUpdate(partnerId, selectedState.embedding);
      }
    }

    const result: ObservationResult = {
      neuronId,
      collapsedState: selectedState,
      probability: probabilities.get(selectedState.id) ?? 0,
      previousEntropy,
      newEntropy: neuron.superposition.entropy,
      observedAt: new Date().toISOString(),
      observer
    };

    neuron.observationHistory.push(result);
    neuron.superposition.lastObserved = result.observedAt;

    return result;
  }

  /**
   * Handle correlated update on partner neuron
   */
  private handleCorrelatedUpdate(neuronId: UUID, observedEmbedding: Embedding384): void {
    const neuron = this.probabilisticNeurons.get(neuronId);
    if (!neuron) return;

    // Boost probability of similar states
    for (const state of neuron.superposition.states) {
      const similarity = cosineSimilarity(state.embedding, observedEmbedding);
      if (similarity > 0.5) {
        state.probability *= (1 + 0.1 * similarity);
      }
    }

    this.normalizeProbabilities(neuron);
    this.updateMetrics(neuron);
  }

  /**
   * Get the most probable state without modifying distribution
   */
  peekMostProbable(
    neuronId: UUID,
    biasEmbedding?: Embedding384
  ): NeuronState | null {
    const neuron = this.probabilisticNeurons.get(neuronId);
    if (!neuron || neuron.superposition.states.length === 0) return null;

    const probabilities = this.calculateBiasedProbabilities(neuron, biasEmbedding);

    let maxProb = 0;
    let mostProbable: NeuronState | null = null;

    for (const state of neuron.superposition.states) {
      const prob = probabilities.get(state.id) ?? 0;
      if (prob > maxProb) {
        maxProb = prob;
        mostProbable = state;
      }
    }

    return mostProbable;
  }

  /**
   * Evolve distribution over time (entropy increase / decay)
   */
  evolve(neuronId: UUID, deltaTime: number): void {
    const neuron = this.probabilisticNeurons.get(neuronId);
    if (!neuron) return;

    // Distribution tends toward uniform over time (maximum entropy)
    const decayFactor = 1 - Math.exp(-this.defaultDecayRate * deltaTime / 1000);
    const uniformProb = 1 / neuron.superposition.states.length;

    for (const state of neuron.superposition.states) {
      // Move toward uniform distribution
      state.probability = state.probability * (1 - decayFactor) + uniformProb * decayFactor;
    }

    // Apply interference between similar states
    if (this.interferenceEnabled) {
      this.applyInterference(neuron);
    }

    this.updateMetrics(neuron);
  }

  /**
   * Create correlation between two neurons (replacement for "entangle")
   */
  entangle(
    neuronIdA: UUID,
    neuronIdB: UUID,
    _bellType: 'Φ+' | 'Φ-' | 'Ψ+' | 'Ψ-' = 'Φ+'
  ): boolean {
    const neuronA = this.probabilisticNeurons.get(neuronIdA);
    const neuronB = this.probabilisticNeurons.get(neuronIdB);

    if (!neuronA || !neuronB) return false;

    // Track correlation
    if (!this.correlationPairs.has(neuronIdA)) {
      this.correlationPairs.set(neuronIdA, new Set());
    }
    if (!this.correlationPairs.has(neuronIdB)) {
      this.correlationPairs.set(neuronIdB, new Set());
    }
    this.correlationPairs.get(neuronIdA)!.add(neuronIdB);
    this.correlationPairs.get(neuronIdB)!.add(neuronIdA);

    return true;
  }

  /**
   * Check if neurons are correlated
   */
  isEntangled(neuronIdA: UUID, neuronIdB?: UUID): boolean {
    if (neuronIdB) {
      return this.correlationPairs.get(neuronIdA)?.has(neuronIdB) ?? false;
    }
    const partners = this.correlationPairs.get(neuronIdA);
    return partners !== undefined && partners.size > 0;
  }

  /**
   * Get correlation info between neurons
   */
  getEntanglementInfo(neuronIdA: UUID, neuronIdB: UUID): EntanglementInfo | null {
    if (!this.isEntangled(neuronIdA, neuronIdB)) return null;

    const neuronA = this.probabilisticNeurons.get(neuronIdA);
    const neuronB = this.probabilisticNeurons.get(neuronIdB);
    if (!neuronA || !neuronB) return null;

    // Calculate correlation from embedding similarities
    let totalCorrelation = 0;
    let count = 0;
    for (const stateA of neuronA.superposition.states) {
      for (const stateB of neuronB.superposition.states) {
        totalCorrelation += cosineSimilarity(stateA.embedding, stateB.embedding);
        count++;
      }
    }

    const avgCorrelation = count > 0 ? totalCorrelation / count : 0;

    return {
      concurrence: Math.abs(avgCorrelation),
      vonNeumannEntropy: (neuronA.superposition.entropy + neuronB.superposition.entropy) / 2,
      bellState: null  // Not using Bell states
    };
  }

  /**
   * Get state distribution info
   */
  getStateDistributionInfo(neuronId: UUID): StateDistributionInfo | null {
    const neuron = this.probabilisticNeurons.get(neuronId);
    if (!neuron) return null;

    const isCorrelated = this.isEntangled(neuronId);
    const correlatedWith = isCorrelated
      ? [...(this.correlationPairs.get(neuronId) ?? [])]
      : undefined;

    return {
      neuronId,
      dimension: neuron.superposition.states.length,
      amplitudes: neuron.superposition.states.map(s => ({
        re: Math.sqrt(s.probability),
        im: 0,
        magnitude: Math.sqrt(s.probability),
        phase: 0
      })),
      probabilities: neuron.superposition.states.map(s => s.probability),
      entropy: neuron.superposition.entropy,
      purity: this.calculatePurity(neuron),
      isEntangled: isCorrelated,
      entangledWith: correlatedWith
    };
  }

  /**
   * Apply a "gate" - transform probabilities
   */
  applyGate(neuronId: UUID, gate: 'X' | 'Y' | 'Z' | 'H' | 'S' | 'T'): void {
    const neuron = this.probabilisticNeurons.get(neuronId);
    if (!neuron || neuron.superposition.states.length !== 2) return;

    const states = neuron.superposition.states;

    switch (gate) {
      case 'X': // Swap probabilities
        [states[0].probability, states[1].probability] =
          [states[1].probability, states[0].probability];
        break;

      case 'H': // Hadamard - move toward 50/50
        states[0].probability = 0.5;
        states[1].probability = 0.5;
        break;

      case 'Z': // No effect on probabilities (legacy gate compatibility)
      case 'Y':
      case 'S':
      case 'T':
        break;
    }

    this.updateMetrics(neuron);
  }

  /**
   * Calculate expected embedding (weighted average)
   */
  getExpectedEmbedding(neuronId: UUID): Embedding384 | null {
    const neuron = this.probabilisticNeurons.get(neuronId);
    if (!neuron || neuron.superposition.states.length === 0) return null;

    const dimension = neuron.superposition.states[0].embedding.length;
    const expected = new Float32Array(dimension);

    let totalWeight = 0;
    for (const state of neuron.superposition.states) {
      totalWeight += state.probability;

      for (let i = 0; i < dimension; i++) {
        expected[i] += state.embedding[i] * state.probability;
      }
    }

    // Normalize
    if (totalWeight > 0) {
      for (let i = 0; i < dimension; i++) {
        expected[i] /= totalWeight;
      }
    }

    return expected;
  }

  /**
   * Get uncertainty (Shannon entropy)
   */
  getUncertainty(neuronId: UUID): number {
    const neuron = this.probabilisticNeurons.get(neuronId);
    return neuron?.superposition.entropy ?? 0;
  }

  /**
   * Split a state into multiple possibilities
   */
  splitState(
    neuronId: UUID,
    stateId: UUID,
    splitEmbeddings: Embedding384[],
    splitRatios?: number[]
  ): NeuronState[] {
    const neuron = this.probabilisticNeurons.get(neuronId);
    if (!neuron) return [];

    const state = neuron.superposition.states.find(s => s.id === stateId);
    if (!state) return [];

    const ratios = splitRatios ?? splitEmbeddings.map(() => 1 / splitEmbeddings.length);
    const newStates: NeuronState[] = [];

    for (let i = 0; i < splitEmbeddings.length; i++) {
      const newState: NeuronState = {
        id: generateUUID(),
        embedding: splitEmbeddings[i],
        probability: state.probability * ratios[i],
        label: state.label ? `${state.label}_split_${i}` : undefined,
        metadata: { ...state.metadata, splitFrom: stateId },
        createdAt: new Date().toISOString()
      };

      newStates.push(newState);
    }

    // Remove original state and add new ones
    neuron.superposition.states = neuron.superposition.states.filter(s => s.id !== stateId);
    neuron.superposition.states.push(...newStates);

    this.normalizeProbabilities(neuron);
    this.updateMetrics(neuron);

    return newStates;
  }

  /**
   * Get probabilistic neuron
   */
  getNeuron(neuronId: UUID): ProbabilisticNeuron | undefined {
    return this.probabilisticNeurons.get(neuronId);
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalNeurons: number;
    totalStates: number;
    averageEntropy: number;
    totalObservations: number;
    averageStatesPerNeuron: number;
  } {
    let totalStates = 0;
    let totalEntropy = 0;
    let totalObservations = 0;

    for (const neuron of this.probabilisticNeurons.values()) {
      totalStates += neuron.superposition.states.length;
      totalEntropy += neuron.superposition.entropy;
      totalObservations += neuron.observationHistory.length;
    }

    const count = this.probabilisticNeurons.size;

    return {
      totalNeurons: count,
      totalStates,
      averageEntropy: count > 0 ? totalEntropy / count : 0,
      totalObservations,
      averageStatesPerNeuron: count > 0 ? totalStates / count : 0
    };
  }

  /**
   * Serialize state for persistence
   */
  serialize(): object {
    const neurons = [];
    for (const [id, neuron] of this.probabilisticNeurons) {
      neurons.push({
        id,
        baseNeuron: {
          ...neuron,
          embedding: Array.from(neuron.embedding),
          superposition: undefined,
          observationHistory: undefined
        },
        superposition: {
          states: neuron.superposition.states.map(s => ({
            ...s,
            embedding: Array.from(s.embedding)
          })),
          entropy: neuron.superposition.entropy,
          dominantState: neuron.superposition.dominantState,
          lastObserved: neuron.superposition.lastObserved
        },
        observationHistory: neuron.observationHistory.slice(-100),
        decayRate: neuron.decayRate
      });
    }

    // Serialize correlations
    const correlations: Record<string, string[]> = {};
    for (const [id, partners] of this.correlationPairs) {
      correlations[id] = [...partners];
    }

    return {
      neurons,
      evolutionHistory: this.evolutionHistory.slice(-1000),
      correlations
    };
  }

  /**
   * Load state from serialized data
   */
  load(data: {
    neurons: Array<{
      id: string;
      baseNeuron: any;
      superposition: any;
      observationHistory: any[];
      decayRate: number;
    }>;
    evolutionHistory?: any[];
    correlations?: Record<string, string[]>;
  }): void {
    this.probabilisticNeurons.clear();
    this.correlationPairs.clear();

    for (const neuronData of data.neurons ?? []) {
      const baseEmbedding = neuronData.baseNeuron.embedding instanceof Float32Array
        ? neuronData.baseNeuron.embedding
        : new Float32Array(neuronData.baseNeuron.embedding);

      const states = (neuronData.superposition?.states ?? []).map((s: any) => ({
        ...s,
        embedding: s.embedding instanceof Float32Array
          ? s.embedding
          : new Float32Array(s.embedding)
      }));

      const probNeuron: ProbabilisticNeuron = {
        ...neuronData.baseNeuron,
        embedding: baseEmbedding,
        superposition: {
          states,
          entropy: neuronData.superposition?.entropy ?? 0,
          dominantState: neuronData.superposition?.dominantState ?? null,
          lastObserved: neuronData.superposition?.lastObserved
        },
        observationHistory: neuronData.observationHistory ?? [],
        decayRate: neuronData.decayRate ?? this.defaultDecayRate
      };

      this.probabilisticNeurons.set(neuronData.id, probNeuron);
    }

    this.evolutionHistory = data.evolutionHistory ?? [];

    // Restore correlations
    if (data.correlations) {
      for (const [id, partners] of Object.entries(data.correlations)) {
        this.correlationPairs.set(id, new Set(partners));
      }
    }
  }

  /**
   * Get all neuron IDs
   */
  getAllNeuronIds(): string[] {
    return Array.from(this.probabilisticNeurons.keys());
  }

  // ==================== Private Methods ====================

  private createStateFromNeuron(neuron: NeuronNode, probability: number): NeuronState {
    return {
      id: generateUUID(),
      embedding: neuron.embedding,
      probability,
      label: 'initial',
      metadata: { sourceNeuronId: neuron.id },
      createdAt: new Date().toISOString()
    };
  }

  private calculateEntropy(states: NeuronState[]): number {
    if (states.length === 0) return 0;

    const totalProb = states.reduce((sum, s) => sum + s.probability, 0);
    if (totalProb === 0) return 0;

    let entropy = 0;
    for (const state of states) {
      const p = state.probability / totalProb;
      if (p > 0) {
        entropy -= p * Math.log2(p);
      }
    }

    return entropy;
  }

  private calculatePurity(neuron: ProbabilisticNeuron): number {
    // Purity = Σ p_i^2 (1 for pure, 1/n for maximally mixed)
    let purity = 0;
    for (const state of neuron.superposition.states) {
      purity += state.probability * state.probability;
    }
    return purity;
  }

  private normalizeProbabilities(neuron: ProbabilisticNeuron): void {
    const total = neuron.superposition.states.reduce((sum, s) => sum + s.probability, 0);

    if (total > 0) {
      for (const state of neuron.superposition.states) {
        state.probability /= total;
      }
    }
  }

  private updateMetrics(neuron: ProbabilisticNeuron): void {
    const states = neuron.superposition.states;

    neuron.superposition.entropy = this.calculateEntropy(states);

    // Find dominant state
    let maxProb = 0;
    let dominant: UUID | null = null;

    for (const state of states) {
      if (state.probability > maxProb) {
        maxProb = state.probability;
        dominant = state.id;
      }
    }

    neuron.superposition.dominantState = dominant;
  }

  private pruneWeakestState(neuron: ProbabilisticNeuron): void {
    let minProb = Infinity;
    let weakestIdx = -1;

    for (let i = 0; i < neuron.superposition.states.length; i++) {
      if (neuron.superposition.states[i].probability < minProb) {
        minProb = neuron.superposition.states[i].probability;
        weakestIdx = i;
      }
    }

    if (weakestIdx >= 0) {
      neuron.superposition.states.splice(weakestIdx, 1);
    }
  }

  private calculateBiasedProbabilities(
    neuron: ProbabilisticNeuron,
    biasEmbedding?: Embedding384
  ): Map<UUID, number> {
    const probabilities = new Map<UUID, number>();

    let total = 0;
    for (const state of neuron.superposition.states) {
      let prob = state.probability;

      // Apply bias if provided
      if (biasEmbedding) {
        const similarity = cosineSimilarity(state.embedding, biasEmbedding);
        prob *= (0.5 + similarity * 0.5);
      }

      probabilities.set(state.id, prob);
      total += prob;
    }

    // Normalize
    if (total > 0) {
      for (const [id, prob] of probabilities) {
        probabilities.set(id, prob / total);
      }
    }

    return probabilities;
  }

  private sampleFromDistribution(
    states: NeuronState[],
    probabilities: Map<UUID, number>
  ): NeuronState | null {
    const random = Math.random();
    let cumulative = 0;

    for (const state of states) {
      cumulative += probabilities.get(state.id) ?? 0;
      if (random < cumulative) {
        return state;
      }
    }

    return states[0] ?? null;
  }

  private updateAfterObservation(
    neuron: ProbabilisticNeuron,
    selectedState: NeuronState,
    boostFactor: number
  ): void {
    // Boost selected state's probability
    for (const state of neuron.superposition.states) {
      if (state.id === selectedState.id) {
        state.probability *= (1 + boostFactor);
      } else {
        state.probability *= (1 - boostFactor * 0.5);
      }
    }

    this.normalizeProbabilities(neuron);
    this.updateMetrics(neuron);
  }

  private applyInterference(neuron: ProbabilisticNeuron): void {
    const states = neuron.superposition.states;
    if (states.length < 2) return;

    // Similar states tend to reinforce each other
    for (let i = 0; i < states.length; i++) {
      for (let j = i + 1; j < states.length; j++) {
        const similarity = cosineSimilarity(states[i].embedding, states[j].embedding);

        if (similarity > 0.8) {
          // Very similar - merge probability mass
          const combined = states[i].probability + states[j].probability;
          const strongerIdx = states[i].probability > states[j].probability ? i : j;
          const weakerIdx = strongerIdx === i ? j : i;

          states[strongerIdx].probability = combined * 0.8;
          states[weakerIdx].probability = combined * 0.2;
        }
      }
    }

    // Remove states with very low probability
    neuron.superposition.states = states.filter(s => s.probability > 0.01);

    this.normalizeProbabilities(neuron);
  }
}

/**
 * Create a ProbabilisticNeuronManager instance
 */
export function createProbabilisticNeuronManager(
  options: ProbabilisticNeuronOptions
): ProbabilisticNeuronManager {
  return new ProbabilisticNeuronManager(options);
}
