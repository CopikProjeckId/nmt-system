/**
 * CLI Types - Shared type definitions for CLI commands
 */

import type { INeuronStore } from '../types/index.js';

/**
 * Context passed to all CLI commands
 * Using 'any' for optional module types to avoid circular dependencies
 */
export interface ProbabilisticContext {
  neuronStore: INeuronStore;
  inferenceEngine?: {
    forwardInfer: (neuron: any) => Promise<any[]>;
    backwardInfer: (neuron: any) => Promise<any[]>;
    findCausalChain: (from: any, to: any) => Promise<any>;
    infer: (neuron: any, options: any) => Promise<any>;
  };
  attractorModel?: {
    createAttractor: (id: string, name: string, description: string, embedding: any, options: any) => any;
    getActiveAttractors: () => any[];
    calculateInfluence: (embedding: any) => Map<string, number>;
    findPathToAttractor: (neuronId: string, attractorId: string, maxDepth: number) => Promise<any>;
    updateAttractor: (id: string, updates: any) => any;
    getStats: () => { totalAttractors: number; activeAttractors: number; transitions: number };
    decayAttractors: () => void;
  };
  learningSystem?: {
    extractMeaningful: (neuronId: string, content: string) => Promise<any[]>;
    getStats: () => any;
    startSession: () => any;
    endSession: () => any;
  };
  neuronManager?: {
    createProbabilisticNeuron: (neuron: any) => Promise<any>;
    addState: (neuronId: string, embedding: any, probability: number) => void;
    observe: (neuronId: string) => Promise<any>;
    evolve: (neuronId: string, time: number) => void;
    entangle: (id1: string, id2: string) => void;
    getUncertainty: (neuronId: string) => number;
    getExpectedEmbedding: (neuronId: string) => Float32Array | null;
    getStats: () => any;
  };
  embeddingManager?: {
    getStats: () => any;
    registerDimension: (name: string, info: any) => void;
    getDimensionsByCategory: (category: string) => string[];
    getCurrentDimensionCount: () => number;
  };
}

/**
 * Configuration for CLI commands
 */
export interface CommandConfig {
  json: boolean;
  topK: number;
  dataDir: string;
}

/**
 * Result returned by CLI commands
 */
export interface CommandResult {
  success: boolean;
  data?: string | object;
  error?: string;
}
