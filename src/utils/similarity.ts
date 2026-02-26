/**
 * Vector Similarity Utilities
 * @module utils/similarity
 */

import type { Embedding384 } from '../types/index.js';

/**
 * Compute cosine similarity between two vectors
 * @param a - First vector
 * @param b - Second vector
 * @returns Similarity value between -1 and 1
 */
export function cosineSimilarity(a: Embedding384 | number[], b: Embedding384 | number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const ai = a[i];
    const bi = b[i];
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dot / denominator;
}

/**
 * Compute Euclidean distance between two vectors
 * @param a - First vector
 * @param b - Second vector
 * @returns Distance value (>= 0)
 */
export function euclideanDistance(a: Embedding384 | number[], b: Embedding384 | number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }

  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }

  return Math.sqrt(sum);
}

/**
 * Compute dot product of two vectors
 * @param a - First vector
 * @param b - Second vector
 * @returns Dot product value
 */
export function dotProduct(a: Embedding384 | number[], b: Embedding384 | number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }

  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

/**
 * Normalize a vector to unit length
 * @param v - Vector to normalize
 * @returns New normalized vector
 */
export function normalize(v: Embedding384 | number[]): Float32Array {
  let norm = 0;
  for (let i = 0; i < v.length; i++) {
    norm += v[i] * v[i];
  }
  norm = Math.sqrt(norm);

  const result = new Float32Array(v.length);
  if (norm === 0) return result;

  for (let i = 0; i < v.length; i++) {
    result[i] = v[i] / norm;
  }
  return result;
}

/**
 * Compute the magnitude (L2 norm) of a vector
 * @param v - Vector
 * @returns Magnitude value
 */
export function magnitude(v: Embedding384 | number[]): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i] * v[i];
  }
  return Math.sqrt(sum);
}

/**
 * Add two vectors
 * @param a - First vector
 * @param b - Second vector
 * @returns Sum vector
 */
export function addVectors(a: Embedding384 | number[], b: Embedding384 | number[]): Float32Array {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }

  const result = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) {
    result[i] = a[i] + b[i];
  }
  return result;
}

/**
 * Compute centroid (average) of multiple vectors
 * @param vectors - Array of vectors
 * @returns Centroid vector
 */
export function centroid(vectors: (Embedding384 | number[])[]): Float32Array {
  if (vectors.length === 0) {
    throw new Error('Cannot compute centroid of empty array');
  }

  const dim = vectors[0].length;
  const result = new Float32Array(dim);

  for (const v of vectors) {
    if (v.length !== dim) {
      throw new Error(`Vector length mismatch: expected ${dim}, got ${v.length}`);
    }
    for (let i = 0; i < dim; i++) {
      result[i] += v[i];
    }
  }

  const n = vectors.length;
  for (let i = 0; i < dim; i++) {
    result[i] /= n;
  }

  return result;
}

/**
 * Convert array to Float32Array embedding
 * @param arr - Number array
 * @returns Float32Array
 */
export function toEmbedding(arr: number[]): Embedding384 {
  return new Float32Array(arr);
}

/**
 * Convert Float32Array to regular array
 * @param embedding - Float32Array
 * @returns Number array
 */
export function fromEmbedding(embedding: Embedding384): number[] {
  return Array.from(embedding);
}
