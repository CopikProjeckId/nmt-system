/**
 * Verification Service - Data integrity verification
 * @module services/verify
 */

import type {
  UUID,
  NeuronNode,
  MerkleProof,
  MerkleTree,
  Chunk,
  SHA3Hash,
  IChunkStore,
  INeuronStore
} from '../types/index.js';
import { MerkleEngine } from '../core/merkle-engine.js';
import { hash, verifyHash } from '../utils/hash.js';

/**
 * Verification result
 */
export interface VerificationResult {
  valid: boolean;
  neuronId: UUID;
  merkleRoot: string;
  errors: string[];
  details: {
    chunksVerified: number;
    chunksFailed: number;
    merkleValid: boolean;
    embeddingValid: boolean;
  };
}

/**
 * Chunk verification result
 */
export interface ChunkVerificationResult {
  hash: SHA3Hash;
  valid: boolean;
  exists: boolean;
  integrityPassed: boolean;
}

/**
 * Proof verification options
 */
export interface ProofVerifyOptions {
  verifyChunkData?: boolean;
}

/**
 * Verification Service
 */
export class VerificationService {
  private merkleEngine: MerkleEngine;
  private chunkStore: IChunkStore;
  private neuronStore: INeuronStore;

  constructor(
    merkleEngine: MerkleEngine,
    chunkStore: IChunkStore,
    neuronStore: INeuronStore
  ) {
    this.merkleEngine = merkleEngine;
    this.chunkStore = chunkStore;
    this.neuronStore = neuronStore;
  }

  /**
   * Verify complete neuron integrity
   */
  async verifyNeuron(neuronId: UUID): Promise<VerificationResult> {
    const neuron = await this.neuronStore.getNeuron(neuronId);

    if (!neuron) {
      return {
        valid: false,
        neuronId,
        merkleRoot: '',
        errors: ['Neuron not found'],
        details: {
          chunksVerified: 0,
          chunksFailed: 0,
          merkleValid: false,
          embeddingValid: false
        }
      };
    }

    const errors: string[] = [];
    let chunksVerified = 0;
    let chunksFailed = 0;

    // Verify each chunk
    for (const chunkHash of neuron.chunkHashes) {
      const result = await this.verifyChunk(chunkHash);
      if (result.valid) {
        chunksVerified++;
      } else {
        chunksFailed++;
        if (!result.exists) {
          errors.push(`Chunk missing: ${chunkHash}`);
        } else if (!result.integrityPassed) {
          errors.push(`Chunk corrupted: ${chunkHash}`);
        }
      }
    }

    // Verify Merkle root
    const merkleValid = await this.verifyMerkleRoot(
      neuron.chunkHashes,
      neuron.merkleRoot
    );

    if (!merkleValid) {
      errors.push('Merkle root verification failed');
    }

    // Verify embedding exists and has correct dimension
    const embeddingValid =
      neuron.embedding instanceof Float32Array &&
      neuron.embedding.length === 384;

    if (!embeddingValid) {
      errors.push('Invalid embedding dimension');
    }

    return {
      valid: errors.length === 0,
      neuronId,
      merkleRoot: neuron.merkleRoot,
      errors,
      details: {
        chunksVerified,
        chunksFailed,
        merkleValid,
        embeddingValid
      }
    };
  }

  /**
   * Verify a single chunk
   */
  async verifyChunk(chunkHash: SHA3Hash): Promise<ChunkVerificationResult> {
    const exists = await this.chunkStore.has(chunkHash);

    if (!exists) {
      return {
        hash: chunkHash,
        valid: false,
        exists: false,
        integrityPassed: false
      };
    }

    const chunk = await this.chunkStore.get(chunkHash);
    if (!chunk) {
      return {
        hash: chunkHash,
        valid: false,
        exists: true,
        integrityPassed: false
      };
    }

    const integrityPassed = verifyHash(chunk.data, chunkHash);

    return {
      hash: chunkHash,
      valid: integrityPassed,
      exists: true,
      integrityPassed
    };
  }

  /**
   * Verify Merkle root matches chunk hashes
   */
  async verifyMerkleRoot(
    chunkHashes: SHA3Hash[],
    expectedRoot: string
  ): Promise<boolean> {
    if (chunkHashes.length === 0) return false;

    const tree = this.merkleEngine.buildTree(chunkHashes);
    return tree.root === expectedRoot;
  }

  /**
   * Verify a Merkle proof
   */
  verifyProof(proof: MerkleProof): boolean {
    return this.merkleEngine.verifyProof(proof);
  }

  /**
   * Verify proof with explicit values
   */
  verifyProofWithValues(
    proof: MerkleProof,
    expectedRoot: string,
    expectedLeaf: SHA3Hash
  ): boolean {
    return this.merkleEngine.verifyProofWithValues(proof, expectedRoot, expectedLeaf);
  }

  /**
   * Generate and verify proof for a specific chunk
   */
  async generateAndVerifyProof(
    neuronId: UUID,
    chunkIndex: number,
    options: ProofVerifyOptions = {}
  ): Promise<{
    proof: MerkleProof | null;
    valid: boolean;
    chunkValid?: boolean;
  }> {
    const neuron = await this.neuronStore.getNeuron(neuronId);
    if (!neuron || chunkIndex < 0 || chunkIndex >= neuron.chunkHashes.length) {
      return { proof: null, valid: false };
    }

    // Build tree and generate proof
    const tree = this.merkleEngine.buildTree(neuron.chunkHashes);
    const proof = this.merkleEngine.generateProof(tree, chunkIndex);

    // Verify proof
    const valid = this.merkleEngine.verifyProof(proof);

    const result: { proof: MerkleProof; valid: boolean; chunkValid?: boolean } = {
      proof,
      valid
    };

    // Optionally verify chunk data
    if (options.verifyChunkData) {
      const chunkHash = neuron.chunkHashes[chunkIndex];
      const chunkResult = await this.verifyChunk(chunkHash);
      result.chunkValid = chunkResult.valid;
    }

    return result;
  }

  /**
   * Verify all neurons in the store
   */
  async verifyAll(): Promise<{
    total: number;
    valid: number;
    invalid: number;
    results: VerificationResult[];
  }> {
    const allIds = await this.neuronStore.getAllNeuronIds();
    const results: VerificationResult[] = [];
    let valid = 0;
    let invalid = 0;

    for (const id of allIds) {
      const result = await this.verifyNeuron(id);
      results.push(result);

      if (result.valid) {
        valid++;
      } else {
        invalid++;
      }
    }

    return {
      total: allIds.length,
      valid,
      invalid,
      results
    };
  }

  /**
   * Verify chunk store integrity
   */
  async verifyChunkStore(): Promise<{
    total: number;
    valid: number;
    corrupted: SHA3Hash[];
    missing: SHA3Hash[];
  }> {
    const storeResult = await this.chunkStore.verifyIntegrity();

    return {
      total: storeResult.valid + storeResult.corrupted.length + storeResult.missing.length,
      valid: storeResult.valid,
      corrupted: storeResult.corrupted,
      missing: storeResult.missing
    };
  }

  /**
   * Verify data against expected hash
   */
  verifyData(data: Buffer | string, expectedHash: SHA3Hash): boolean {
    return verifyHash(data, expectedHash);
  }

  /**
   * Compute hash for data
   */
  computeHash(data: Buffer | string): SHA3Hash {
    return hash(data);
  }

  /**
   * Get verification summary for a neuron
   */
  async getVerificationSummary(neuronId: UUID): Promise<{
    exists: boolean;
    merkleRoot?: string;
    chunkCount?: number;
    allChunksExist?: boolean;
    merkleValid?: boolean;
  }> {
    const neuron = await this.neuronStore.getNeuron(neuronId);

    if (!neuron) {
      return { exists: false };
    }

    let allChunksExist = true;
    for (const chunkHash of neuron.chunkHashes) {
      const exists = await this.chunkStore.has(chunkHash);
      if (!exists) {
        allChunksExist = false;
        break;
      }
    }

    const merkleValid = await this.verifyMerkleRoot(
      neuron.chunkHashes,
      neuron.merkleRoot
    );

    return {
      exists: true,
      merkleRoot: neuron.merkleRoot,
      chunkCount: neuron.chunkHashes.length,
      allChunksExist,
      merkleValid
    };
  }
}

/**
 * Create a VerificationService instance
 */
export function createVerificationService(
  merkleEngine: MerkleEngine,
  chunkStore: IChunkStore,
  neuronStore: INeuronStore
): VerificationService {
  return new VerificationService(merkleEngine, chunkStore, neuronStore);
}
