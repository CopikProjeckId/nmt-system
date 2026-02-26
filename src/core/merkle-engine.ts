/**
 * Merkle Engine - Tree construction and verification
 *
 * Extended features:
 * - Tree diff computation
 * - Batch proofs for multiple leaves
 * - Range proofs for consecutive leaves
 * - Versioned trees
 *
 * @module core/merkle-engine
 */

import type { MerkleTree, MerkleProof, SHA3Hash, MerkleRoot } from '../types/index.js';
import { hash, hashPair } from '../utils/hash.js';

/**
 * Difference between two Merkle trees
 */
export interface TreeDiff {
  /** Leaves added in newTree */
  added: SHA3Hash[];
  /** Leaves removed from oldTree */
  removed: SHA3Hash[];
  /** Leaves modified (same index, different hash) */
  modified: { index: number; oldHash: SHA3Hash; newHash: SHA3Hash }[];
  /** Old root */
  oldRoot: MerkleRoot;
  /** New root */
  newRoot: MerkleRoot;
}

/**
 * Batch proof for multiple leaves
 */
export interface BatchMerkleProof {
  /** Leaves being proven */
  leaves: { index: number; hash: SHA3Hash }[];
  /** Deduplicated sibling nodes: "level:index" -> hash */
  siblings: Record<string, SHA3Hash>;
  /** Root hash */
  root: MerkleRoot;
}

/**
 * Range proof for consecutive leaves
 */
export interface RangeProof {
  /** Start index (inclusive) */
  startIndex: number;
  /** End index (exclusive) */
  endIndex: number;
  /** Leaves in range */
  leaves: SHA3Hash[];
  /** Left boundary proof */
  leftProof: MerkleProof | null;
  /** Right boundary proof */
  rightProof: MerkleProof | null;
  /** Root hash */
  root: MerkleRoot;
}

/**
 * Versioned Merkle tree with parent tracking
 */
export interface VersionedMerkleTree extends MerkleTree {
  /** Version number */
  version: number;
  /** Parent root (null for initial version) */
  parentRoot: MerkleRoot | null;
  /** Version timestamp */
  timestamp: string;
  /** Changes from parent (if any) */
  diff?: TreeDiff;
}

/**
 * MerkleEngine class for tree operations
 */
export class MerkleEngine {
  /**
   * Build a Merkle tree from leaf hashes
   * @param leaves - Array of leaf hashes
   * @returns Complete Merkle tree structure
   */
  buildTree(leaves: SHA3Hash[]): MerkleTree {
    if (leaves.length === 0) {
      throw new Error('Cannot build Merkle tree from empty leaves');
    }

    const originalLeaves = [...leaves];

    // Pad to power of 2 by duplicating last leaf
    const paddedLeaves = [...leaves];
    while (!this.isPowerOfTwo(paddedLeaves.length)) {
      paddedLeaves.push(paddedLeaves[paddedLeaves.length - 1]);
    }

    // Build levels from bottom to top
    const levels: SHA3Hash[][] = [paddedLeaves];
    let currentLevel = paddedLeaves;

    while (currentLevel.length > 1) {
      const nextLevel: SHA3Hash[] = [];

      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right = currentLevel[i + 1];
        const parent = hashPair(left, right);
        nextLevel.push(parent);
      }

      levels.push(nextLevel);
      currentLevel = nextLevel;
    }

    return {
      root: currentLevel[0],
      levels,
      leafCount: originalLeaves.length,
      originalLeaves
    };
  }

  /**
   * Build Merkle tree from raw data buffers
   * @param data - Array of data buffers
   * @returns Merkle tree with hashed leaves
   */
  buildTreeFromData(data: Buffer[]): MerkleTree {
    const leaves = data.map(d => hash(d));
    return this.buildTree(leaves);
  }

  /**
   * Generate inclusion proof for a leaf
   * @param tree - Merkle tree
   * @param leafIndex - Index of leaf to prove
   * @returns Merkle proof
   */
  generateProof(tree: MerkleTree, leafIndex: number): MerkleProof {
    if (leafIndex < 0 || leafIndex >= tree.leafCount) {
      throw new Error(`Invalid leaf index: ${leafIndex}`);
    }

    const siblings: SHA3Hash[] = [];
    const directions: boolean[] = [];

    // Handle padding - if index is beyond padded leaves, use last leaf
    let currentIndex = Math.min(leafIndex, tree.levels[0].length - 1);

    // Traverse from leaf to root
    for (let level = 0; level < tree.levels.length - 1; level++) {
      const currentLevel = tree.levels[level];
      const isLeft = currentIndex % 2 === 0;
      const siblingIndex = isLeft ? currentIndex + 1 : currentIndex - 1;

      // Ensure sibling exists
      if (siblingIndex >= 0 && siblingIndex < currentLevel.length) {
        siblings.push(currentLevel[siblingIndex]);
        directions.push(isLeft);
      }

      // Move to parent index
      currentIndex = Math.floor(currentIndex / 2);
    }

    return {
      leaf: tree.levels[0][Math.min(leafIndex, tree.levels[0].length - 1)],
      leafIndex,
      siblings,
      directions,
      root: tree.root
    };
  }

  /**
   * Verify a Merkle proof
   * @param proof - Proof to verify
   * @returns true if proof is valid
   */
  verifyProof(proof: MerkleProof): boolean {
    let currentHash = proof.leaf;

    for (let i = 0; i < proof.siblings.length; i++) {
      const sibling = proof.siblings[i];
      const isLeft = proof.directions[i];

      if (isLeft) {
        currentHash = hashPair(currentHash, sibling);
      } else {
        currentHash = hashPair(sibling, currentHash);
      }
    }

    return currentHash === proof.root;
  }

  /**
   * Verify proof with explicit root and leaf
   * @param proof - Proof structure
   * @param root - Expected root hash
   * @param leaf - Expected leaf hash
   * @returns true if valid
   */
  verifyProofWithValues(
    proof: MerkleProof,
    root: MerkleRoot,
    leaf: SHA3Hash
  ): boolean {
    return proof.root === root && proof.leaf === leaf && this.verifyProof(proof);
  }

  /**
   * Compute the root hash directly from leaves
   * @param leaves - Leaf hashes
   * @returns Root hash
   */
  computeRoot(leaves: SHA3Hash[]): MerkleRoot {
    return this.buildTree(leaves).root;
  }

  /**
   * Update a leaf in the tree (returns new tree)
   * @param tree - Original tree
   * @param index - Leaf index to update
   * @param newLeaf - New leaf hash
   * @returns Updated tree
   */
  updateLeaf(tree: MerkleTree, index: number, newLeaf: SHA3Hash): MerkleTree {
    if (index < 0 || index >= tree.leafCount) {
      throw new Error(`Invalid leaf index: ${index}`);
    }

    // Create new original leaves array
    const newOriginalLeaves = [...tree.originalLeaves];
    newOriginalLeaves[index] = newLeaf;

    // Rebuild tree with new leaves
    return this.buildTree(newOriginalLeaves);
  }

  /**
   * Add a new leaf to the tree
   * @param tree - Original tree
   * @param newLeaf - New leaf hash
   * @returns Updated tree
   */
  addLeaf(tree: MerkleTree, newLeaf: SHA3Hash): MerkleTree {
    const newLeaves = [...tree.originalLeaves, newLeaf];
    return this.buildTree(newLeaves);
  }

  /**
   * Get the height of the tree
   * @param tree - Merkle tree
   * @returns Tree height (number of levels)
   */
  getHeight(tree: MerkleTree): number {
    return tree.levels.length;
  }

  /**
   * Get all nodes at a specific level
   * @param tree - Merkle tree
   * @param level - Level index (0 = leaves)
   * @returns Array of hashes at that level
   */
  getLevel(tree: MerkleTree, level: number): SHA3Hash[] {
    if (level < 0 || level >= tree.levels.length) {
      throw new Error(`Invalid level: ${level}`);
    }
    return [...tree.levels[level]];
  }

  /**
   * Serialize tree to JSON-friendly format
   */
  serialize(tree: MerkleTree): object {
    return {
      root: tree.root,
      levels: tree.levels,
      leafCount: tree.leafCount,
      originalLeaves: tree.originalLeaves
    };
  }

  /**
   * Deserialize tree from JSON
   */
  deserialize(data: {
    root: MerkleRoot;
    levels: SHA3Hash[][];
    leafCount: number;
    originalLeaves: SHA3Hash[];
  }): MerkleTree {
    return {
      root: data.root,
      levels: data.levels,
      leafCount: data.leafCount,
      originalLeaves: data.originalLeaves
    };
  }

  // ==================== EXTENDED FEATURES ====================

  /**
   * Compute the difference between two Merkle trees
   *
   * @param oldTree - Original tree
   * @param newTree - Updated tree
   * @returns TreeDiff with added, removed, and modified leaves
   *
   * @example
   * ```typescript
   * const tree1 = engine.buildTree(['a', 'b', 'c']);
   * const tree2 = engine.buildTree(['a', 'b', 'd']);
   * const diff = engine.computeDiff(tree1, tree2);
   * // diff.modified = [{ index: 2, oldHash: 'c', newHash: 'd' }]
   * ```
   */
  computeDiff(oldTree: MerkleTree, newTree: MerkleTree): TreeDiff {
    const added: SHA3Hash[] = [];
    const removed: SHA3Hash[] = [];
    const modified: { index: number; oldHash: SHA3Hash; newHash: SHA3Hash }[] = [];

    const oldLeaves = oldTree.originalLeaves;
    const newLeaves = newTree.originalLeaves;

    // Find modified and removed
    for (let i = 0; i < oldLeaves.length; i++) {
      if (i < newLeaves.length) {
        if (oldLeaves[i] !== newLeaves[i]) {
          modified.push({
            index: i,
            oldHash: oldLeaves[i],
            newHash: newLeaves[i],
          });
        }
      } else {
        removed.push(oldLeaves[i]);
      }
    }

    // Find added
    for (let i = oldLeaves.length; i < newLeaves.length; i++) {
      added.push(newLeaves[i]);
    }

    return {
      added,
      removed,
      modified,
      oldRoot: oldTree.root,
      newRoot: newTree.root,
    };
  }

  /**
   * Check if two trees have the same content
   */
  treesEqual(tree1: MerkleTree, tree2: MerkleTree): boolean {
    return tree1.root === tree2.root;
  }

  /**
   * Generate a batch proof for multiple leaves at once
   *
   * More efficient than generating individual proofs as siblings are deduplicated.
   *
   * @param tree - Merkle tree
   * @param indices - Array of leaf indices to prove
   * @returns BatchMerkleProof with deduplicated siblings
   *
   * @example
   * ```typescript
   * const batchProof = engine.generateBatchProof(tree, [0, 2, 5]);
   * const valid = engine.verifyBatchProof(batchProof);
   * ```
   */
  generateBatchProof(tree: MerkleTree, indices: number[]): BatchMerkleProof {
    if (indices.length === 0) {
      throw new Error('Cannot generate batch proof for empty indices');
    }

    // Validate indices
    for (const index of indices) {
      if (index < 0 || index >= tree.leafCount) {
        throw new Error(`Invalid leaf index: ${index}`);
      }
    }

    const leaves: { index: number; hash: SHA3Hash }[] = [];
    const siblings: Record<string, SHA3Hash> = {};

    // Collect leaves
    for (const index of indices) {
      const actualIndex = Math.min(index, tree.levels[0].length - 1);
      leaves.push({
        index,
        hash: tree.levels[0][actualIndex],
      });
    }

    // For each level, track which nodes we need vs which we can compute
    const nodesNeeded = new Set<string>();

    // Mark all leaf nodes we have
    for (const index of indices) {
      const actualIndex = Math.min(index, tree.levels[0].length - 1);
      nodesNeeded.add(`0:${actualIndex}`);
    }

    // Traverse up the tree to find all needed siblings
    for (let level = 0; level < tree.levels.length - 1; level++) {
      const currentLevel = tree.levels[level];
      const parentNodesNeeded = new Set<string>();

      // Find siblings we need for this level
      for (const nodeKey of nodesNeeded) {
        const [lvl, idx] = nodeKey.split(':').map(Number);
        if (lvl !== level) continue;

        const isLeft = idx % 2 === 0;
        const siblingIndex = isLeft ? idx + 1 : idx - 1;

        // If sibling exists and we don't already have it, add to siblings
        if (siblingIndex >= 0 && siblingIndex < currentLevel.length) {
          const siblingKey = `${level}:${siblingIndex}`;
          if (!nodesNeeded.has(siblingKey)) {
            siblings[siblingKey] = currentLevel[siblingIndex];
          }
        }

        // Mark parent as needed
        const parentIndex = Math.floor(idx / 2);
        parentNodesNeeded.add(`${level + 1}:${parentIndex}`);
      }

      // Add parent nodes to needed set
      for (const key of parentNodesNeeded) {
        nodesNeeded.add(key);
      }
    }

    return {
      leaves,
      siblings,
      root: tree.root,
    };
  }

  /**
   * Verify a batch proof
   *
   * @param proof - BatchMerkleProof to verify
   * @returns true if all leaves are proven to be in the tree
   */
  verifyBatchProof(proof: BatchMerkleProof): boolean {
    if (proof.leaves.length === 0) {
      return false;
    }

    // Build a map of known node hashes
    const knownNodes = new Map<string, SHA3Hash>();

    // Add leaves
    for (const { index, hash } of proof.leaves) {
      knownNodes.set(`0:${index}`, hash);
    }

    // Add siblings
    for (const [key, hash] of Object.entries(proof.siblings)) {
      knownNodes.set(key, hash);
    }

    // Find the maximum level we need to compute
    const maxLevel = Math.ceil(Math.log2(
      Math.max(...proof.leaves.map(l => l.index + 1))
    )) + 1;

    // Compute up the tree
    for (let level = 0; level < maxLevel; level++) {
      const indices = new Set<number>();

      for (const key of knownNodes.keys()) {
        const [lvl, idx] = key.split(':').map(Number);
        if (lvl === level) {
          indices.add(Math.floor(idx / 2));
        }
      }

      for (const parentIndex of indices) {
        const leftKey = `${level}:${parentIndex * 2}`;
        const rightKey = `${level}:${parentIndex * 2 + 1}`;

        const left = knownNodes.get(leftKey);
        const right = knownNodes.get(rightKey);

        if (left && right) {
          const parentHash = hashPair(left, right);
          knownNodes.set(`${level + 1}:${parentIndex}`, parentHash);
        }
      }
    }

    // Find the root (should be at 0 index of highest level)
    for (const [key, hash] of knownNodes.entries()) {
      if (key.endsWith(':0') && hash === proof.root) {
        return true;
      }
    }

    return false;
  }

  /**
   * Generate a range proof for consecutive leaves
   *
   * Useful for proving a subset of the tree without full proofs for each leaf.
   *
   * @param tree - Merkle tree
   * @param startIndex - Start index (inclusive)
   * @param endIndex - End index (exclusive)
   * @returns RangeProof
   */
  generateRangeProof(
    tree: MerkleTree,
    startIndex: number,
    endIndex: number
  ): RangeProof {
    if (startIndex < 0 || startIndex >= tree.leafCount) {
      throw new Error(`Invalid start index: ${startIndex}`);
    }
    if (endIndex <= startIndex || endIndex > tree.leafCount) {
      throw new Error(`Invalid end index: ${endIndex}`);
    }

    // Get leaves in range
    const leaves = tree.originalLeaves.slice(startIndex, endIndex);

    // Generate boundary proofs
    const leftProof = startIndex > 0
      ? this.generateProof(tree, startIndex)
      : null;

    const rightProof = endIndex < tree.leafCount
      ? this.generateProof(tree, endIndex - 1)
      : null;

    return {
      startIndex,
      endIndex,
      leaves,
      leftProof,
      rightProof,
      root: tree.root,
    };
  }

  /**
   * Verify a range proof
   *
   * @param proof - RangeProof to verify
   * @returns true if the range is valid
   */
  verifyRangeProof(proof: RangeProof): boolean {
    // Verify boundary proofs if they exist
    if (proof.leftProof) {
      if (proof.leftProof.root !== proof.root) {
        return false;
      }
      if (!this.verifyProof(proof.leftProof)) {
        return false;
      }
      // Check that the left boundary leaf matches
      if (proof.leftProof.leaf !== proof.leaves[0]) {
        return false;
      }
    }

    if (proof.rightProof) {
      if (proof.rightProof.root !== proof.root) {
        return false;
      }
      if (!this.verifyProof(proof.rightProof)) {
        return false;
      }
      // Check that the right boundary leaf matches
      if (proof.rightProof.leaf !== proof.leaves[proof.leaves.length - 1]) {
        return false;
      }
    }

    // Verify the range is contiguous
    if (proof.endIndex - proof.startIndex !== proof.leaves.length) {
      return false;
    }

    return true;
  }

  /**
   * Create a versioned tree from an existing tree
   *
   * @param tree - Source tree
   * @param parentRoot - Parent version root (null for initial)
   * @returns VersionedMerkleTree
   */
  createVersion(
    tree: MerkleTree,
    parentRoot: MerkleRoot | null = null
  ): VersionedMerkleTree {
    return {
      ...tree,
      version: parentRoot ? 1 : 0, // Version increments handled externally
      parentRoot,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Create a new version from changes
   *
   * @param currentVersion - Current versioned tree
   * @param newTree - New tree state
   * @returns New VersionedMerkleTree with diff
   */
  createNewVersion(
    currentVersion: VersionedMerkleTree,
    newTree: MerkleTree
  ): VersionedMerkleTree {
    const diff = this.computeDiff(currentVersion, newTree);

    return {
      ...newTree,
      version: currentVersion.version + 1,
      parentRoot: currentVersion.root,
      timestamp: new Date().toISOString(),
      diff,
    };
  }

  /**
   * Serialize a versioned tree
   */
  serializeVersioned(tree: VersionedMerkleTree): object {
    return {
      ...this.serialize(tree),
      version: tree.version,
      parentRoot: tree.parentRoot,
      timestamp: tree.timestamp,
      diff: tree.diff,
    };
  }

  /**
   * Deserialize a versioned tree
   */
  deserializeVersioned(data: {
    root: MerkleRoot;
    levels: SHA3Hash[][];
    leafCount: number;
    originalLeaves: SHA3Hash[];
    version: number;
    parentRoot: MerkleRoot | null;
    timestamp: string;
    diff?: TreeDiff;
  }): VersionedMerkleTree {
    return {
      root: data.root,
      levels: data.levels,
      leafCount: data.leafCount,
      originalLeaves: data.originalLeaves,
      version: data.version,
      parentRoot: data.parentRoot,
      timestamp: data.timestamp,
      diff: data.diff,
    };
  }

  /**
   * Check if number is power of 2
   */
  private isPowerOfTwo(n: number): boolean {
    return n > 0 && (n & (n - 1)) === 0;
  }
}

/**
 * Create a MerkleEngine instance
 */
export function createMerkleEngine(): MerkleEngine {
  return new MerkleEngine();
}
