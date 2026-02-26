/**
 * Clustering Module - Automatic neuron grouping and topic modeling
 * @module extensions/clustering
 */

import type {
  UUID,
  NeuronNode,
  Embedding384,
  INeuronStore
} from '../../types/index.js';
import { cosineSimilarity, centroid } from '../../utils/similarity.js';
import { generateUUID } from '../../utils/uuid.js';

/**
 * Cluster definition
 */
export interface Cluster {
  id: UUID;
  name?: string;
  centroid: Float32Array;
  members: UUID[];
  avgSimilarity: number;
  metadata: {
    createdAt: string;
    updatedAt: string;
    algorithmUsed: string;
  };
}

/**
 * Clustering result
 */
export interface ClusteringResult {
  clusters: Cluster[];
  noise?: UUID[];  // For DBSCAN
  iterations?: number;  // For K-means
  silhouetteScore?: number;
}

/**
 * K-means options
 */
export interface KMeansOptions {
  k: number;
  maxIterations?: number;
  tolerance?: number;
  initMethod?: 'random' | 'kmeans++';
}

/**
 * DBSCAN options
 */
export interface DBSCANOptions {
  eps: number;  // Neighborhood radius
  minPts: number;  // Minimum points to form cluster
}

/**
 * Community detection options
 */
export interface CommunityOptions {
  resolution?: number;  // Louvain resolution
  minCommunitySize?: number;
}

/**
 * Clustering Service
 */
export class ClusteringService {
  private neuronStore: INeuronStore;
  private clusters: Map<UUID, Cluster>;

  constructor(neuronStore: INeuronStore) {
    this.neuronStore = neuronStore;
    this.clusters = new Map();
  }

  /**
   * K-means clustering
   */
  async kmeans(options: KMeansOptions): Promise<ClusteringResult> {
    const {
      k,
      maxIterations = 100,
      tolerance = 1e-4,
      initMethod = 'kmeans++'
    } = options;

    // Get all neurons
    const neurons = await this.getAllNeurons();
    if (neurons.length < k) {
      throw new Error(`Not enough neurons (${neurons.length}) for ${k} clusters`);
    }

    // Initialize centroids
    let centroids = initMethod === 'kmeans++'
      ? this.initKMeansPlusPlus(neurons, k)
      : this.initRandom(neurons, k);

    let assignments: number[] = new Array(neurons.length).fill(-1);
    let iterations = 0;
    let converged = false;

    while (iterations < maxIterations && !converged) {
      // Assign neurons to nearest centroid
      const newAssignments = neurons.map(n =>
        this.findNearestCentroid(n.embedding, centroids)
      );

      // Check convergence
      converged = assignments.every((a, i) => a === newAssignments[i]);
      assignments = newAssignments;

      if (!converged) {
        // Update centroids
        const newCentroids = this.updateCentroids(neurons, assignments, k);

        // Check centroid movement
        let maxMovement = 0;
        for (let i = 0; i < k; i++) {
          const movement = 1 - cosineSimilarity(centroids[i], newCentroids[i]);
          maxMovement = Math.max(maxMovement, movement);
        }

        if (maxMovement < tolerance) {
          converged = true;
        }

        centroids = newCentroids;
      }

      iterations++;
    }

    // Build clusters
    const clusters = this.buildClusters(neurons, assignments, centroids, 'kmeans');

    // Calculate silhouette score
    const silhouetteScore = this.calculateSilhouette(neurons, assignments, clusters);

    // Store clusters
    for (const cluster of clusters) {
      this.clusters.set(cluster.id, cluster);
    }

    return {
      clusters,
      iterations,
      silhouetteScore
    };
  }

  /**
   * DBSCAN clustering
   */
  async dbscan(options: DBSCANOptions): Promise<ClusteringResult> {
    const { eps, minPts } = options;

    const neurons = await this.getAllNeurons();
    const n = neurons.length;

    // Build distance matrix (using 1 - similarity)
    const distances: number[][] = [];
    for (let i = 0; i < n; i++) {
      distances[i] = [];
      for (let j = 0; j < n; j++) {
        distances[i][j] = 1 - cosineSimilarity(neurons[i].embedding, neurons[j].embedding);
      }
    }

    const labels: number[] = new Array(n).fill(-1);  // -1 = unvisited
    const noise: UUID[] = [];
    let clusterId = 0;

    for (let i = 0; i < n; i++) {
      if (labels[i] !== -1) continue;  // Already processed

      // Find neighbors
      const neighbors = this.regionQuery(distances, i, eps);

      if (neighbors.length < minPts) {
        labels[i] = 0;  // Mark as noise
        noise.push(neurons[i].id);
      } else {
        // Expand cluster
        clusterId++;
        this.expandCluster(
          distances,
          labels,
          i,
          neighbors,
          clusterId,
          eps,
          minPts
        );
      }
    }

    // Build clusters from labels
    const clusterMap = new Map<number, UUID[]>();
    for (let i = 0; i < n; i++) {
      if (labels[i] > 0) {
        if (!clusterMap.has(labels[i])) {
          clusterMap.set(labels[i], []);
        }
        clusterMap.get(labels[i])!.push(neurons[i].id);
      }
    }

    const clusters: Cluster[] = [];
    for (const [, members] of clusterMap) {
      const memberNeurons = neurons.filter(n => members.includes(n.id));
      const centroidVec = centroid(memberNeurons.map(n => n.embedding));

      clusters.push({
        id: generateUUID(),
        centroid: centroidVec,
        members,
        avgSimilarity: this.calculateAvgSimilarity(memberNeurons),
        metadata: {
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          algorithmUsed: 'dbscan'
        }
      });
    }

    // Store clusters
    for (const cluster of clusters) {
      this.clusters.set(cluster.id, cluster);
    }

    return {
      clusters,
      noise
    };
  }

  /**
   * Hierarchical clustering (Agglomerative)
   */
  async hierarchical(
    targetClusters: number,
    linkage: 'single' | 'complete' | 'average' = 'average'
  ): Promise<ClusteringResult> {
    const neurons = await this.getAllNeurons();
    const n = neurons.length;

    // Initialize: each neuron is its own cluster
    let currentClusters: Array<{
      members: number[];
      centroid: Float32Array;
    }> = neurons.map((neuron, i) => ({
      members: [i],
      centroid: new Float32Array(neuron.embedding)
    }));

    // Build similarity matrix
    const similarities: number[][] = [];
    for (let i = 0; i < n; i++) {
      similarities[i] = [];
      for (let j = 0; j < n; j++) {
        similarities[i][j] = cosineSimilarity(neurons[i].embedding, neurons[j].embedding);
      }
    }

    // Merge until target cluster count
    while (currentClusters.length > targetClusters) {
      // Find most similar pair
      let maxSim = -Infinity;
      let mergeI = 0, mergeJ = 1;

      for (let i = 0; i < currentClusters.length; i++) {
        for (let j = i + 1; j < currentClusters.length; j++) {
          const sim = this.calculateLinkage(
            currentClusters[i].members,
            currentClusters[j].members,
            similarities,
            linkage
          );

          if (sim > maxSim) {
            maxSim = sim;
            mergeI = i;
            mergeJ = j;
          }
        }
      }

      // Merge clusters
      const merged = {
        members: [...currentClusters[mergeI].members, ...currentClusters[mergeJ].members],
        centroid: centroid([currentClusters[mergeI].centroid, currentClusters[mergeJ].centroid])
      };

      // Remove old clusters and add merged
      currentClusters = currentClusters.filter((_, idx) => idx !== mergeI && idx !== mergeJ);
      currentClusters.push(merged);
    }

    // Build final clusters
    const clusters: Cluster[] = currentClusters.map(c => {
      const memberNeurons = c.members.map(i => neurons[i]);
      return {
        id: generateUUID(),
        centroid: c.centroid,
        members: memberNeurons.map(n => n.id),
        avgSimilarity: this.calculateAvgSimilarity(memberNeurons),
        metadata: {
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          algorithmUsed: `hierarchical-${linkage}`
        }
      };
    });

    // Store clusters
    for (const cluster of clusters) {
      this.clusters.set(cluster.id, cluster);
    }

    return { clusters };
  }

  /**
   * Get cluster by ID
   */
  getCluster(id: UUID): Cluster | undefined {
    return this.clusters.get(id);
  }

  /**
   * Get all clusters
   */
  getAllClusters(): Cluster[] {
    return Array.from(this.clusters.values());
  }

  /**
   * Find cluster for a neuron
   */
  findClusterForNeuron(neuronId: UUID): Cluster | undefined {
    for (const cluster of this.clusters.values()) {
      if (cluster.members.includes(neuronId)) {
        return cluster;
      }
    }
    return undefined;
  }

  /**
   * Assign new neuron to nearest cluster
   */
  async assignToCluster(neuronId: UUID): Promise<Cluster | null> {
    const neuron = await this.neuronStore.getNeuron(neuronId);
    if (!neuron) return null;

    let bestCluster: Cluster | null = null;
    let bestSimilarity = -Infinity;

    for (const cluster of this.clusters.values()) {
      const sim = cosineSimilarity(neuron.embedding, cluster.centroid);
      if (sim > bestSimilarity) {
        bestSimilarity = sim;
        bestCluster = cluster;
      }
    }

    if (bestCluster) {
      bestCluster.members.push(neuronId);
      bestCluster.metadata.updatedAt = new Date().toISOString();

      // Update centroid
      const memberNeurons = await this.getNeuronsByIds(bestCluster.members);
      bestCluster.centroid = centroid(memberNeurons.map(n => n.embedding));
      bestCluster.avgSimilarity = this.calculateAvgSimilarity(memberNeurons);
    }

    return bestCluster;
  }

  /**
   * Get cluster statistics
   */
  getStats(): {
    totalClusters: number;
    avgClusterSize: number;
    largestCluster: number;
    smallestCluster: number;
  } {
    const clusters = Array.from(this.clusters.values());
    const sizes = clusters.map(c => c.members.length);

    return {
      totalClusters: clusters.length,
      avgClusterSize: sizes.length > 0
        ? sizes.reduce((a, b) => a + b, 0) / sizes.length
        : 0,
      largestCluster: sizes.length > 0 ? Math.max(...sizes) : 0,
      smallestCluster: sizes.length > 0 ? Math.min(...sizes) : 0
    };
  }

  // ==================== Private Methods ====================

  private async getAllNeurons(): Promise<NeuronNode[]> {
    const ids = await this.neuronStore.getAllNeuronIds();
    const neurons: NeuronNode[] = [];

    for (const id of ids) {
      const neuron = await this.neuronStore.getNeuron(id);
      if (neuron) neurons.push(neuron);
    }

    return neurons;
  }

  private async getNeuronsByIds(ids: UUID[]): Promise<NeuronNode[]> {
    const neurons: NeuronNode[] = [];
    for (const id of ids) {
      const neuron = await this.neuronStore.getNeuron(id);
      if (neuron) neurons.push(neuron);
    }
    return neurons;
  }

  private initRandom(neurons: NeuronNode[], k: number): Float32Array[] {
    const indices = new Set<number>();
    while (indices.size < k) {
      indices.add(Math.floor(Math.random() * neurons.length));
    }

    return Array.from(indices).map(i => new Float32Array(neurons[i].embedding));
  }

  private initKMeansPlusPlus(neurons: NeuronNode[], k: number): Float32Array[] {
    const centroids: Float32Array[] = [];

    // Choose first centroid randomly
    const firstIdx = Math.floor(Math.random() * neurons.length);
    centroids.push(new Float32Array(neurons[firstIdx].embedding));

    // Choose remaining centroids
    for (let c = 1; c < k; c++) {
      const distances: number[] = neurons.map(n => {
        let minDist = Infinity;
        for (const cent of centroids) {
          const dist = 1 - cosineSimilarity(n.embedding, cent);
          minDist = Math.min(minDist, dist);
        }
        return minDist * minDist;  // Square for probability
      });

      // Weighted random selection
      const totalDist = distances.reduce((a, b) => a + b, 0);
      let random = Math.random() * totalDist;

      for (let i = 0; i < neurons.length; i++) {
        random -= distances[i];
        if (random <= 0) {
          centroids.push(new Float32Array(neurons[i].embedding));
          break;
        }
      }
    }

    return centroids;
  }

  private findNearestCentroid(embedding: Embedding384, centroids: Float32Array[]): number {
    let maxSim = -Infinity;
    let nearest = 0;

    for (let i = 0; i < centroids.length; i++) {
      const sim = cosineSimilarity(embedding, centroids[i]);
      if (sim > maxSim) {
        maxSim = sim;
        nearest = i;
      }
    }

    return nearest;
  }

  private updateCentroids(
    neurons: NeuronNode[],
    assignments: number[],
    k: number
  ): Float32Array[] {
    const centroids: Float32Array[] = [];

    for (let c = 0; c < k; c++) {
      const members = neurons.filter((_, i) => assignments[i] === c);

      if (members.length > 0) {
        centroids.push(centroid(members.map(m => m.embedding)));
      } else {
        // Empty cluster - reinitialize randomly
        const randomIdx = Math.floor(Math.random() * neurons.length);
        centroids.push(new Float32Array(neurons[randomIdx].embedding));
      }
    }

    return centroids;
  }

  private buildClusters(
    neurons: NeuronNode[],
    assignments: number[],
    centroids: Float32Array[],
    algorithm: string
  ): Cluster[] {
    const clusters: Cluster[] = [];

    for (let c = 0; c < centroids.length; c++) {
      const members = neurons
        .filter((_, i) => assignments[i] === c)
        .map(n => n.id);

      const memberNeurons = neurons.filter((_, i) => assignments[i] === c);

      clusters.push({
        id: generateUUID(),
        centroid: centroids[c],
        members,
        avgSimilarity: this.calculateAvgSimilarity(memberNeurons),
        metadata: {
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          algorithmUsed: algorithm
        }
      });
    }

    return clusters;
  }

  private calculateAvgSimilarity(neurons: NeuronNode[]): number {
    if (neurons.length < 2) return 1;

    let totalSim = 0;
    let count = 0;

    for (let i = 0; i < neurons.length; i++) {
      for (let j = i + 1; j < neurons.length; j++) {
        totalSim += cosineSimilarity(neurons[i].embedding, neurons[j].embedding);
        count++;
      }
    }

    return count > 0 ? totalSim / count : 1;
  }

  private calculateSilhouette(
    neurons: NeuronNode[],
    assignments: number[],
    clusters: Cluster[]
  ): number {
    if (clusters.length < 2) return 0;

    let totalScore = 0;

    for (let i = 0; i < neurons.length; i++) {
      const myCluster = assignments[i];

      // Calculate a(i) - average distance to same cluster
      const sameCluster = neurons.filter((_, j) => assignments[j] === myCluster && j !== i);
      const a = sameCluster.length > 0
        ? sameCluster.reduce((sum, n) =>
            sum + (1 - cosineSimilarity(neurons[i].embedding, n.embedding)), 0
          ) / sameCluster.length
        : 0;

      // Calculate b(i) - minimum average distance to other clusters
      let b = Infinity;
      for (let c = 0; c < clusters.length; c++) {
        if (c === myCluster) continue;

        const otherCluster = neurons.filter((_, j) => assignments[j] === c);
        if (otherCluster.length > 0) {
          const avgDist = otherCluster.reduce((sum, n) =>
            sum + (1 - cosineSimilarity(neurons[i].embedding, n.embedding)), 0
          ) / otherCluster.length;
          b = Math.min(b, avgDist);
        }
      }

      // Silhouette score for this point
      const s = Math.max(a, b) > 0 ? (b - a) / Math.max(a, b) : 0;
      totalScore += s;
    }

    return totalScore / neurons.length;
  }

  private regionQuery(distances: number[][], pointIdx: number, eps: number): number[] {
    const neighbors: number[] = [];
    for (let i = 0; i < distances.length; i++) {
      if (distances[pointIdx][i] <= eps) {
        neighbors.push(i);
      }
    }
    return neighbors;
  }

  private expandCluster(
    distances: number[][],
    labels: number[],
    pointIdx: number,
    neighbors: number[],
    clusterId: number,
    eps: number,
    minPts: number
  ): void {
    labels[pointIdx] = clusterId;

    const queue = [...neighbors];
    let i = 0;

    while (i < queue.length) {
      const q = queue[i];

      if (labels[q] === 0) {
        // Was noise, now border point
        labels[q] = clusterId;
      }

      if (labels[q] !== -1) {
        i++;
        continue;
      }

      labels[q] = clusterId;

      const qNeighbors = this.regionQuery(distances, q, eps);
      if (qNeighbors.length >= minPts) {
        for (const n of qNeighbors) {
          if (!queue.includes(n)) {
            queue.push(n);
          }
        }
      }

      i++;
    }
  }

  private calculateLinkage(
    cluster1: number[],
    cluster2: number[],
    similarities: number[][],
    linkage: 'single' | 'complete' | 'average'
  ): number {
    const allSims: number[] = [];

    for (const i of cluster1) {
      for (const j of cluster2) {
        allSims.push(similarities[i][j]);
      }
    }

    switch (linkage) {
      case 'single':
        return Math.max(...allSims);
      case 'complete':
        return Math.min(...allSims);
      case 'average':
        return allSims.reduce((a, b) => a + b, 0) / allSims.length;
    }
  }
}

/**
 * Create a ClusteringService instance
 */
export function createClusteringService(neuronStore: INeuronStore): ClusteringService {
  return new ClusteringService(neuronStore);
}

