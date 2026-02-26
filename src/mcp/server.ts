/**
 * NMT MCP Server
 * Model Context Protocol server for NMT system
 *
 * @module mcp/server
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { ChunkEngine } from '../core/chunk-engine.js';
import { MerkleEngine } from '../core/merkle-engine.js';
import { HNSWIndex } from '../core/hnsw-index.js';
import { NeuronGraphManager } from '../core/neuron-graph.js';
import { ChunkStore } from '../storage/chunk-store.js';
import { NeuronStore } from '../storage/neuron-store.js';
import { IndexStore } from '../storage/index-store.js';
import { IngestionService } from '../services/ingestion.js';
import { QueryService } from '../services/query.js';
import { VerificationService } from '../services/verify.js';
import { ClusteringService } from '../extensions/clustering/index.js';

/**
 * NMT MCP Server
 */
export class NMTMCPServer {
  private server: Server;
  private dataDir: string;

  // Core components
  private chunkEngine!: ChunkEngine;
  private merkleEngine!: MerkleEngine;
  private hnswIndex!: HNSWIndex;
  private chunkStore!: ChunkStore;
  private neuronStore!: NeuronStore;
  private indexStore!: IndexStore;
  private graphManager!: NeuronGraphManager;
  private ingestionService!: IngestionService;
  private queryService!: QueryService;
  private verifyService!: VerificationService;
  private clusteringService!: ClusteringService;

  private initialized = false;

  constructor(dataDir: string = './data') {
    this.dataDir = dataDir;

    this.server = new Server(
      {
        name: 'nmt-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    this.setupHandlers();
  }

  /**
   * Initialize all components
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    this.chunkEngine = new ChunkEngine();
    this.merkleEngine = new MerkleEngine();
    this.hnswIndex = new HNSWIndex();

    this.chunkStore = new ChunkStore({ dataDir: this.dataDir });
    this.neuronStore = new NeuronStore({ dataDir: this.dataDir });
    this.indexStore = new IndexStore({ dataDir: this.dataDir });

    await this.chunkStore.init();
    await this.neuronStore.init();
    await this.indexStore.init();

    const existingIndex = await this.indexStore.load('main');
    if (existingIndex) {
      this.hnswIndex = existingIndex;
    }

    this.graphManager = new NeuronGraphManager({
      neuronStore: this.neuronStore,
      hnswIndex: this.hnswIndex,
    });

    this.ingestionService = new IngestionService(
      this.chunkEngine,
      this.merkleEngine,
      this.graphManager,
      this.chunkStore
    );

    this.queryService = new QueryService(
      this.graphManager,
      this.merkleEngine,
      this.chunkStore,
      this.neuronStore
    );

    this.verifyService = new VerificationService(
      this.merkleEngine,
      this.chunkStore,
      this.neuronStore
    );

    this.clusteringService = new ClusteringService(this.neuronStore);

    this.initialized = true;
  }

  /**
   * Setup MCP handlers
   */
  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'nmt_save',
          description: '텍스트를 NMT에 저장합니다. 저장된 텍스트는 나중에 의미 검색으로 찾을 수 있습니다.',
          inputSchema: {
            type: 'object',
            properties: {
              text: {
                type: 'string',
                description: '저장할 텍스트',
              },
              tags: {
                type: 'array',
                items: { type: 'string' },
                description: '태그 목록 (선택사항)',
              },
            },
            required: ['text'],
          },
        },
        {
          name: 'nmt_search',
          description: '의미적으로 유사한 내용을 검색합니다. 키워드가 아닌 의미 기반 검색입니다.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: '검색할 내용',
              },
              limit: {
                type: 'number',
                description: '최대 결과 개수 (기본값: 10)',
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'nmt_get',
          description: '특정 뉴런의 내용을 가져옵니다.',
          inputSchema: {
            type: 'object',
            properties: {
              neuronId: {
                type: 'string',
                description: '뉴런 ID',
              },
            },
            required: ['neuronId'],
          },
        },
        {
          name: 'nmt_verify',
          description: '데이터의 무결성을 검증합니다. 위변조 여부를 확인합니다.',
          inputSchema: {
            type: 'object',
            properties: {
              neuronId: {
                type: 'string',
                description: '검증할 뉴런 ID',
              },
            },
            required: ['neuronId'],
          },
        },
        {
          name: 'nmt_connect',
          description: '두 뉴런을 연결합니다.',
          inputSchema: {
            type: 'object',
            properties: {
              sourceId: {
                type: 'string',
                description: '시작 뉴런 ID',
              },
              targetId: {
                type: 'string',
                description: '대상 뉴런 ID',
              },
              type: {
                type: 'string',
                enum: ['semantic', 'reference', 'temporal', 'causal'],
                description: '연결 유형',
              },
            },
            required: ['sourceId', 'targetId', 'type'],
          },
        },
        {
          name: 'nmt_related',
          description: '특정 뉴런과 연결된 관련 뉴런들을 찾습니다.',
          inputSchema: {
            type: 'object',
            properties: {
              neuronId: {
                type: 'string',
                description: '뉴런 ID',
              },
              depth: {
                type: 'number',
                description: '탐색 깊이 (기본값: 2)',
              },
            },
            required: ['neuronId'],
          },
        },
        {
          name: 'nmt_stats',
          description: 'NMT 시스템 통계를 가져옵니다.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'nmt_cluster',
          description: '저장된 뉴런들을 클러스터링합니다.',
          inputSchema: {
            type: 'object',
            properties: {
              k: {
                type: 'number',
                description: '클러스터 개수',
              },
            },
            required: ['k'],
          },
        },
      ],
    }));

    // List resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: 'nmt://stats',
          name: 'NMT Statistics',
          description: '현재 NMT 시스템 통계',
          mimeType: 'application/json',
        },
        {
          uri: 'nmt://neurons',
          name: 'Recent Neurons',
          description: '최근 저장된 뉴런 목록',
          mimeType: 'application/json',
        },
      ],
    }));

    // Read resource
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      await this.init();
      const uri = request.params.uri;

      if (uri === 'nmt://stats') {
        const graphStats = await this.graphManager.getStats();
        const chunkStats = await this.chunkStore.getStats();
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify({
                neurons: graphStats.neuronCount,
                synapses: graphStats.synapseCount,
                chunks: chunkStats.totalChunks,
                totalSize: chunkStats.totalSize,
              }, null, 2),
            },
          ],
        };
      }

      if (uri === 'nmt://neurons') {
        const neurons = await this.queryService.getRecentlyAccessed(20);
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(
                neurons.map((n) => ({
                  id: n.id,
                  tags: n.metadata.tags,
                  createdAt: n.metadata.createdAt,
                })),
                null,
                2
              ),
            },
          ],
        };
      }

      throw new Error(`Unknown resource: ${uri}`);
    });

    // Call tool
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      await this.init();
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'nmt_save': {
            const { text, tags } = args as { text: string; tags?: string[] };
            const neuron = await this.ingestionService.ingestText(text, {
              tags,
              autoConnect: true,
            });
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    neuronId: neuron.id,
                    merkleRoot: neuron.merkleRoot,
                    message: `텍스트가 저장되었습니다. ID: ${neuron.id}`,
                  }),
                },
              ],
            };
          }

          case 'nmt_search': {
            const { query, limit = 10 } = args as { query: string; limit?: number };
            const results = await this.queryService.search(query, {
              k: limit,
              includeContent: true,
            });
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    count: results.length,
                    results: results.map((r) => ({
                      id: r.neuron.id,
                      score: r.score,
                      content: r.content,
                      tags: r.neuron.metadata.tags,
                    })),
                  }),
                },
              ],
            };
          }

          case 'nmt_get': {
            const { neuronId } = args as { neuronId: string };
            const neuron = await this.queryService.getNeuron(neuronId);
            if (!neuron) {
              return {
                content: [{ type: 'text', text: JSON.stringify({ error: 'Neuron not found' }) }],
              };
            }
            const content = await this.queryService.getContent(neuron);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    id: neuron.id,
                    content,
                    tags: neuron.metadata.tags,
                    merkleRoot: neuron.merkleRoot,
                    createdAt: neuron.metadata.createdAt,
                  }),
                },
              ],
            };
          }

          case 'nmt_verify': {
            const { neuronId } = args as { neuronId: string };
            const result = await this.verifyService.verifyNeuron(neuronId);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    valid: result.valid,
                    neuronId: result.neuronId,
                    message: result.valid
                      ? '데이터가 검증되었습니다. 위변조되지 않았습니다.'
                      : '경고: 데이터가 변조되었을 수 있습니다!',
                  }),
                },
              ],
            };
          }

          case 'nmt_connect': {
            const { sourceId, targetId, type } = args as {
              sourceId: string;
              targetId: string;
              type: string;
            };
            const synapse = await this.graphManager.connect(sourceId, targetId, type as any);
            if (!synapse) {
              return {
                content: [{ type: 'text', text: JSON.stringify({ error: 'Failed to connect' }) }],
              };
            }
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    synapseId: synapse.id,
                    message: `뉴런이 연결되었습니다.`,
                  }),
                },
              ],
            };
          }

          case 'nmt_related': {
            const { neuronId, depth = 2 } = args as { neuronId: string; depth?: number };
            const results = await this.queryService.searchSimilarTo(neuronId, { k: 10 });
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    count: results.length,
                    related: results.map((r) => ({
                      id: r.neuron.id,
                      score: r.score,
                      tags: r.neuron.metadata.tags,
                    })),
                  }),
                },
              ],
            };
          }

          case 'nmt_stats': {
            const graphStats = await this.graphManager.getStats();
            const chunkStats = await this.chunkStore.getStats();
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    neurons: graphStats.neuronCount,
                    synapses: graphStats.synapseCount,
                    chunks: chunkStats.totalChunks,
                    totalSize: chunkStats.totalSize,
                    indexNodes: graphStats.indexStats.totalNodes,
                  }),
                },
              ],
            };
          }

          case 'nmt_cluster': {
            const { k } = args as { k: number };
            const result = await this.clusteringService.kmeans({ k });
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    clusterCount: result.clusters.length,
                    silhouetteScore: result.silhouetteScore,
                    clusters: result.clusters.map((c) => ({
                      id: c.id,
                      memberCount: c.members.length,
                      avgSimilarity: c.avgSimilarity,
                    })),
                  }),
                },
              ],
            };
          }

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: true,
                message: error instanceof Error ? error.message : 'Unknown error',
              }),
            },
          ],
        };
      }
    });
  }

  /**
   * Start the MCP server
   */
  async start(): Promise<void> {
    await this.init();
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('NMT MCP Server running on stdio');
  }

  /**
   * Close the server
   */
  async close(): Promise<void> {
    await this.indexStore.save('main', this.hnswIndex);
    await this.chunkStore.close();
    await this.neuronStore.close();
    await this.indexStore.close();
  }
}

// Main entry point
const server = new NMTMCPServer(process.env.NMT_DATA_DIR || './data');

server.start().catch((error) => {
  console.error('Failed to start NMT MCP Server:', error);
  process.exit(1);
});

// Handle shutdown
process.on('SIGINT', async () => {
  await server.close();
  process.exit(0);
});
