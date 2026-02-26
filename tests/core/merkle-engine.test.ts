/**
 * Merkle Engine Tests
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MerkleEngine } from '../../src/core/merkle-engine.js';
import { hash } from '../../src/utils/hash.js';

describe('MerkleEngine', () => {
  let merkle: MerkleEngine;

  beforeEach(() => {
    merkle = new MerkleEngine();
  });

  describe('buildTree', () => {
    it('should build tree from single leaf', () => {
      const leaves = [hash('leaf1')];
      const tree = merkle.buildTree(leaves);

      expect(tree.root).toBeDefined();
      expect(tree.root).toHaveLength(64); // SHA-256 hex
      expect(tree.leafCount).toBe(1);
    });

    it('should build tree from multiple leaves', () => {
      const leaves = [hash('leaf1'), hash('leaf2'), hash('leaf3'), hash('leaf4')];
      const tree = merkle.buildTree(leaves);

      expect(tree.root).toBeDefined();
      expect(tree.leafCount).toBe(4);
      expect(merkle.getHeight(tree)).toBe(3); // log2(4) + 1
    });

    it('should produce deterministic root', () => {
      const leaves = [hash('a'), hash('b'), hash('c')];
      const tree1 = merkle.buildTree(leaves);
      const tree2 = merkle.buildTree(leaves);

      expect(tree1.root).toBe(tree2.root);
    });

    it('should produce different roots for different leaves', () => {
      const tree1 = merkle.buildTree([hash('a'), hash('b')]);
      const tree2 = merkle.buildTree([hash('c'), hash('d')]);

      expect(tree1.root).not.toBe(tree2.root);
    });

    it('should throw error for empty leaves', () => {
      expect(() => merkle.buildTree([])).toThrow('Cannot build Merkle tree from empty leaves');
    });
  });

  describe('generateProof', () => {
    it('should generate valid proof for leaf', () => {
      const leaves = [hash('a'), hash('b'), hash('c'), hash('d')];
      const tree = merkle.buildTree(leaves);

      const proof = merkle.generateProof(tree, 0);

      expect(proof).toBeDefined();
      expect(proof.siblings.length).toBeGreaterThan(0);
      expect(proof.leafIndex).toBe(0);
    });

    it('should throw error for invalid index', () => {
      const leaves = [hash('a'), hash('b')];
      const tree = merkle.buildTree(leaves);

      expect(() => merkle.generateProof(tree, 10)).toThrow('Invalid leaf index');
    });
  });

  describe('verifyProof', () => {
    it('should verify valid proof', () => {
      const leaves = [hash('a'), hash('b'), hash('c'), hash('d')];
      const tree = merkle.buildTree(leaves);
      const proof = merkle.generateProof(tree, 2);

      const isValid = merkle.verifyProof(proof);

      expect(isValid).toBe(true);
    });

    it('should reject tampered proof', () => {
      const leaves = [hash('a'), hash('b'), hash('c'), hash('d')];
      const tree = merkle.buildTree(leaves);
      const proof = merkle.generateProof(tree, 0);

      // Tamper with leaf hash
      proof.leaf = 'tampered_hash_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

      const isValid = merkle.verifyProof(proof);

      expect(isValid).toBe(false);
    });

    it('should reject proof against wrong root', () => {
      const leaves = [hash('a'), hash('b'), hash('c'), hash('d')];
      const tree = merkle.buildTree(leaves);
      const proof = merkle.generateProof(tree, 0);

      // Verify with different root
      const isValid = merkle.verifyProofWithValues(
        proof,
        'wrong_root_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        proof.leaf
      );

      expect(isValid).toBe(false);
    });
  });

  describe('computeRoot', () => {
    it('should compute root directly from leaves', () => {
      const leaves = [hash('a'), hash('b'), hash('c')];
      const tree = merkle.buildTree(leaves);
      const directRoot = merkle.computeRoot(leaves);

      expect(directRoot).toBe(tree.root);
    });
  });

  describe('updateLeaf', () => {
    it('should update a leaf and produce new tree', () => {
      const leaves = [hash('a'), hash('b'), hash('c')];
      const tree = merkle.buildTree(leaves);
      const originalRoot = tree.root;

      const updatedTree = merkle.updateLeaf(tree, 1, hash('new_b'));

      expect(updatedTree.root).not.toBe(originalRoot);
      expect(updatedTree.leafCount).toBe(3);
    });
  });

  describe('addLeaf', () => {
    it('should add a new leaf to tree', () => {
      const leaves = [hash('a'), hash('b')];
      const tree = merkle.buildTree(leaves);

      const newTree = merkle.addLeaf(tree, hash('c'));

      expect(newTree.leafCount).toBe(3);
      expect(newTree.root).not.toBe(tree.root);
    });
  });

  describe('serialize/deserialize', () => {
    it('should serialize and deserialize tree correctly', () => {
      const leaves = [hash('a'), hash('b'), hash('c')];
      const tree = merkle.buildTree(leaves);

      const serialized = merkle.serialize(tree);
      const deserialized = merkle.deserialize(serialized as any);

      expect(deserialized.root).toBe(tree.root);
      expect(deserialized.leafCount).toBe(tree.leafCount);
    });
  });

  // ==================== EXTENDED FEATURES TESTS ====================

  describe('computeDiff', () => {
    it('should detect no changes for identical trees', () => {
      const leaves = [hash('a'), hash('b'), hash('c')];
      const tree1 = merkle.buildTree(leaves);
      const tree2 = merkle.buildTree(leaves);

      const diff = merkle.computeDiff(tree1, tree2);

      expect(diff.added).toHaveLength(0);
      expect(diff.removed).toHaveLength(0);
      expect(diff.modified).toHaveLength(0);
    });

    it('should detect modified leaves', () => {
      const tree1 = merkle.buildTree([hash('a'), hash('b'), hash('c')]);
      const tree2 = merkle.buildTree([hash('a'), hash('B'), hash('c')]);

      const diff = merkle.computeDiff(tree1, tree2);

      expect(diff.modified).toHaveLength(1);
      expect(diff.modified[0].index).toBe(1);
      expect(diff.modified[0].oldHash).toBe(hash('b'));
      expect(diff.modified[0].newHash).toBe(hash('B'));
    });

    it('should detect added leaves', () => {
      const tree1 = merkle.buildTree([hash('a'), hash('b')]);
      const tree2 = merkle.buildTree([hash('a'), hash('b'), hash('c')]);

      const diff = merkle.computeDiff(tree1, tree2);

      expect(diff.added).toHaveLength(1);
      expect(diff.added[0]).toBe(hash('c'));
    });

    it('should detect removed leaves', () => {
      const tree1 = merkle.buildTree([hash('a'), hash('b'), hash('c')]);
      const tree2 = merkle.buildTree([hash('a'), hash('b')]);

      const diff = merkle.computeDiff(tree1, tree2);

      expect(diff.removed).toHaveLength(1);
      expect(diff.removed[0]).toBe(hash('c'));
    });

    it('should detect multiple changes', () => {
      const tree1 = merkle.buildTree([hash('a'), hash('b'), hash('c'), hash('d')]);
      const tree2 = merkle.buildTree([hash('a'), hash('B'), hash('C'), hash('d'), hash('e')]);

      const diff = merkle.computeDiff(tree1, tree2);

      expect(diff.modified).toHaveLength(2); // b→B, c→C
      expect(diff.added).toHaveLength(1); // e
      expect(diff.oldRoot).toBe(tree1.root);
      expect(diff.newRoot).toBe(tree2.root);
    });
  });

  describe('treesEqual', () => {
    it('should return true for identical trees', () => {
      const leaves = [hash('a'), hash('b')];
      const tree1 = merkle.buildTree(leaves);
      const tree2 = merkle.buildTree(leaves);

      expect(merkle.treesEqual(tree1, tree2)).toBe(true);
    });

    it('should return false for different trees', () => {
      const tree1 = merkle.buildTree([hash('a'), hash('b')]);
      const tree2 = merkle.buildTree([hash('c'), hash('d')]);

      expect(merkle.treesEqual(tree1, tree2)).toBe(false);
    });
  });

  describe('generateBatchProof', () => {
    it('should generate batch proof for multiple indices', () => {
      const leaves = [hash('a'), hash('b'), hash('c'), hash('d')];
      const tree = merkle.buildTree(leaves);

      const batchProof = merkle.generateBatchProof(tree, [0, 2]);

      expect(batchProof.leaves).toHaveLength(2);
      expect(batchProof.leaves[0].index).toBe(0);
      expect(batchProof.leaves[1].index).toBe(2);
      expect(batchProof.root).toBe(tree.root);
    });

    it('should throw error for empty indices', () => {
      const tree = merkle.buildTree([hash('a'), hash('b')]);

      expect(() => merkle.generateBatchProof(tree, [])).toThrow('Cannot generate batch proof for empty indices');
    });

    it('should throw error for invalid index', () => {
      const tree = merkle.buildTree([hash('a'), hash('b')]);

      expect(() => merkle.generateBatchProof(tree, [10])).toThrow('Invalid leaf index');
    });

    it('should deduplicate siblings', () => {
      const leaves = [hash('a'), hash('b'), hash('c'), hash('d')];
      const tree = merkle.buildTree(leaves);

      // Get batch proof for adjacent leaves (should share some siblings)
      const batchProof = merkle.generateBatchProof(tree, [0, 1]);

      // The number of siblings should be less than 2 individual proofs combined
      const individualProof0 = merkle.generateProof(tree, 0);
      const individualProof1 = merkle.generateProof(tree, 1);

      const totalIndividualSiblings = individualProof0.siblings.length + individualProof1.siblings.length;
      const batchSiblings = Object.keys(batchProof.siblings).length;

      expect(batchSiblings).toBeLessThanOrEqual(totalIndividualSiblings);
    });
  });

  describe('verifyBatchProof', () => {
    it('should verify valid batch proof', () => {
      const leaves = [hash('a'), hash('b'), hash('c'), hash('d')];
      const tree = merkle.buildTree(leaves);
      const batchProof = merkle.generateBatchProof(tree, [0, 2, 3]);

      const isValid = merkle.verifyBatchProof(batchProof);

      expect(isValid).toBe(true);
    });

    it('should reject empty batch proof', () => {
      const batchProof = {
        leaves: [],
        siblings: {},
        root: hash('fake'),
      };

      expect(merkle.verifyBatchProof(batchProof)).toBe(false);
    });

    it('should reject tampered batch proof', () => {
      const leaves = [hash('a'), hash('b'), hash('c'), hash('d')];
      const tree = merkle.buildTree(leaves);
      const batchProof = merkle.generateBatchProof(tree, [0, 1]);

      // Tamper with a leaf
      batchProof.leaves[0].hash = hash('tampered');

      expect(merkle.verifyBatchProof(batchProof)).toBe(false);
    });
  });

  describe('generateRangeProof', () => {
    it('should generate range proof for consecutive leaves', () => {
      const leaves = [hash('a'), hash('b'), hash('c'), hash('d'), hash('e')];
      const tree = merkle.buildTree(leaves);

      const rangeProof = merkle.generateRangeProof(tree, 1, 4);

      expect(rangeProof.startIndex).toBe(1);
      expect(rangeProof.endIndex).toBe(4);
      expect(rangeProof.leaves).toHaveLength(3);
      expect(rangeProof.leaves[0]).toBe(hash('b'));
      expect(rangeProof.leaves[2]).toBe(hash('d'));
    });

    it('should include boundary proofs', () => {
      const leaves = [hash('a'), hash('b'), hash('c'), hash('d')];
      const tree = merkle.buildTree(leaves);

      const rangeProof = merkle.generateRangeProof(tree, 1, 3);

      expect(rangeProof.leftProof).not.toBeNull();
      expect(rangeProof.rightProof).not.toBeNull();
    });

    it('should handle range from start', () => {
      const leaves = [hash('a'), hash('b'), hash('c')];
      const tree = merkle.buildTree(leaves);

      const rangeProof = merkle.generateRangeProof(tree, 0, 2);

      expect(rangeProof.leftProof).toBeNull(); // No left boundary needed
      expect(rangeProof.leaves).toHaveLength(2);
    });

    it('should throw error for invalid range', () => {
      const tree = merkle.buildTree([hash('a'), hash('b')]);

      expect(() => merkle.generateRangeProof(tree, 5, 10)).toThrow('Invalid start index');
      expect(() => merkle.generateRangeProof(tree, 1, 1)).toThrow('Invalid end index');
    });
  });

  describe('verifyRangeProof', () => {
    it('should verify valid range proof', () => {
      const leaves = [hash('a'), hash('b'), hash('c'), hash('d')];
      const tree = merkle.buildTree(leaves);
      const rangeProof = merkle.generateRangeProof(tree, 1, 3);

      const isValid = merkle.verifyRangeProof(rangeProof);

      expect(isValid).toBe(true);
    });

    it('should reject range proof with wrong root', () => {
      const leaves = [hash('a'), hash('b'), hash('c'), hash('d')];
      const tree = merkle.buildTree(leaves);
      const rangeProof = merkle.generateRangeProof(tree, 1, 3);

      rangeProof.root = hash('wrong');

      expect(merkle.verifyRangeProof(rangeProof)).toBe(false);
    });

    it('should reject range proof with mismatched leaves', () => {
      const leaves = [hash('a'), hash('b'), hash('c'), hash('d')];
      const tree = merkle.buildTree(leaves);
      const rangeProof = merkle.generateRangeProof(tree, 1, 3);

      // Add extra leaf making length mismatch
      rangeProof.leaves.push(hash('extra'));

      expect(merkle.verifyRangeProof(rangeProof)).toBe(false);
    });
  });

  describe('createVersion', () => {
    it('should create initial versioned tree', () => {
      const leaves = [hash('a'), hash('b')];
      const tree = merkle.buildTree(leaves);

      const versioned = merkle.createVersion(tree);

      expect(versioned.version).toBe(0);
      expect(versioned.parentRoot).toBeNull();
      expect(versioned.timestamp).toBeDefined();
      expect(versioned.root).toBe(tree.root);
    });

    it('should create versioned tree with parent', () => {
      const tree = merkle.buildTree([hash('a'), hash('b')]);
      const parentRoot = hash('parent');

      const versioned = merkle.createVersion(tree, parentRoot);

      expect(versioned.version).toBe(1);
      expect(versioned.parentRoot).toBe(parentRoot);
    });
  });

  describe('createNewVersion', () => {
    it('should create new version with diff', () => {
      const tree1 = merkle.buildTree([hash('a'), hash('b')]);
      const versioned1 = merkle.createVersion(tree1);

      const tree2 = merkle.buildTree([hash('a'), hash('B')]);
      const versioned2 = merkle.createNewVersion(versioned1, tree2);

      expect(versioned2.version).toBe(1);
      expect(versioned2.parentRoot).toBe(versioned1.root);
      expect(versioned2.diff).toBeDefined();
      expect(versioned2.diff!.modified).toHaveLength(1);
    });

    it('should increment version correctly', () => {
      let tree = merkle.buildTree([hash('a')]);
      let versioned = merkle.createVersion(tree);

      for (let i = 0; i < 5; i++) {
        tree = merkle.addLeaf(tree, hash(`leaf${i}`));
        versioned = merkle.createNewVersion(versioned, tree);
      }

      expect(versioned.version).toBe(5);
    });
  });

  describe('serializeVersioned/deserializeVersioned', () => {
    it('should serialize and deserialize versioned tree', () => {
      const tree = merkle.buildTree([hash('a'), hash('b')]);
      const versioned = merkle.createVersion(tree);

      const serialized = merkle.serializeVersioned(versioned);
      const deserialized = merkle.deserializeVersioned(serialized as any);

      expect(deserialized.root).toBe(versioned.root);
      expect(deserialized.version).toBe(versioned.version);
      expect(deserialized.parentRoot).toBe(versioned.parentRoot);
      expect(deserialized.timestamp).toBe(versioned.timestamp);
    });

    it('should preserve diff in serialization', () => {
      const tree1 = merkle.buildTree([hash('a'), hash('b')]);
      const versioned1 = merkle.createVersion(tree1);

      const tree2 = merkle.buildTree([hash('a'), hash('B')]);
      const versioned2 = merkle.createNewVersion(versioned1, tree2);

      const serialized = merkle.serializeVersioned(versioned2);
      const deserialized = merkle.deserializeVersioned(serialized as any);

      expect(deserialized.diff).toBeDefined();
      expect(deserialized.diff!.modified).toHaveLength(1);
    });
  });
});
