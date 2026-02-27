/**
 * DB Bridge Service — Import/Export between external databases and NMT
 * @module services/db-bridge
 */

import type { UUID, NeuronNode, Synapse, INeuronStore } from '../types/index.js';
import type {
  IDBConnector,
  DBRow,
  DatabaseSchema,
  TableSchema,
  ColumnSchema,
  ImportOptions,
  ImportResult,
  ExportOptions,
  ExportResult,
} from '../connectors/types.js';
import type { IngestionService } from './ingestion.js';

/**
 * Serialize a DB row to text for embedding generation
 */
function rowToText(row: DBRow, tableName: string): string {
  const parts: string[] = [`[${tableName}]`];
  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined) continue;
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
      parts.push(`${key}: <binary ${(value as Buffer).length} bytes>`);
    } else if (typeof value === 'object') {
      parts.push(`${key}: ${JSON.stringify(value)}`);
    } else {
      parts.push(`${key}: ${String(value)}`);
    }
  }
  return parts.join('\n');
}

/**
 * Convert a NeuronNode to a flat DB row for export
 */
function neuronToRow(
  neuron: NeuronNode,
  includeEmbedding: boolean
): DBRow {
  const row: DBRow = {
    id: neuron.id,
    merkle_root: neuron.merkleRoot,
    chunk_count: neuron.chunkHashes.length,
    source_type: neuron.metadata.sourceType,
    neuron_type: neuron.metadata.neuronType ?? null,
    importance: neuron.metadata.importance ?? null,
    tags: JSON.stringify(neuron.metadata.tags),
    chunk_hashes: JSON.stringify(neuron.chunkHashes),
    access_count: neuron.metadata.accessCount,
    created_at: neuron.metadata.createdAt,
    updated_at: neuron.metadata.updatedAt,
    last_accessed: neuron.metadata.lastAccessed,
  };

  if (includeEmbedding) {
    row.embedding = Buffer.from(
      neuron.embedding.buffer,
      neuron.embedding.byteOffset,
      neuron.embedding.byteLength
    );
  }

  return row;
}

/**
 * Convert a Synapse to a flat DB row for export
 */
function synapseToRow(synapse: Synapse): DBRow {
  return {
    id: synapse.id,
    source_id: synapse.sourceId,
    target_id: synapse.targetId,
    type: synapse.type,
    weight: synapse.weight,
    bidirectional: synapse.metadata.bidirectional,
    activation_count: synapse.metadata.activationCount,
    created_at: synapse.metadata.createdAt,
    updated_at: synapse.metadata.updatedAt,
  };
}

/**
 * Generate neuron table schema for export
 */
function getNeuronTableSchema(
  tableName: string,
  includeEmbedding: boolean
): TableSchema {
  const columns: ColumnSchema[] = [
    { name: 'id', type: 'VARCHAR(36)', nullable: false, isPrimary: true, isForeign: false },
    { name: 'merkle_root', type: 'VARCHAR(64)', nullable: false, isPrimary: false, isForeign: false },
    { name: 'chunk_count', type: 'INT', nullable: false, isPrimary: false, isForeign: false },
    { name: 'source_type', type: 'VARCHAR(100)', nullable: true, isPrimary: false, isForeign: false },
    { name: 'neuron_type', type: 'VARCHAR(20)', nullable: true, isPrimary: false, isForeign: false },
    { name: 'importance', type: 'FLOAT', nullable: true, isPrimary: false, isForeign: false },
    { name: 'tags', type: 'JSON', nullable: true, isPrimary: false, isForeign: false },
    { name: 'chunk_hashes', type: 'JSON', nullable: true, isPrimary: false, isForeign: false },
    { name: 'access_count', type: 'INT', nullable: false, isPrimary: false, isForeign: false, defaultValue: 0 },
    { name: 'created_at', type: 'TIMESTAMP', nullable: true, isPrimary: false, isForeign: false },
    { name: 'updated_at', type: 'TIMESTAMP', nullable: true, isPrimary: false, isForeign: false },
    { name: 'last_accessed', type: 'TIMESTAMP', nullable: true, isPrimary: false, isForeign: false },
  ];

  if (includeEmbedding) {
    columns.splice(2, 0, {
      name: 'embedding',
      type: 'LONGBLOB',
      nullable: true,
      isPrimary: false,
      isForeign: false,
    });
  }

  return {
    name: tableName,
    columns,
    primaryKey: ['id'],
    foreignKeys: [],
    rowCount: 0,
  };
}

/**
 * Generate synapse table schema for export
 */
function getSynapseTableSchema(tableName: string, neuronTable: string): TableSchema {
  return {
    name: tableName,
    columns: [
      { name: 'id', type: 'VARCHAR(36)', nullable: false, isPrimary: true, isForeign: false },
      { name: 'source_id', type: 'VARCHAR(36)', nullable: false, isPrimary: false, isForeign: true, foreignTable: neuronTable, foreignColumn: 'id' },
      { name: 'target_id', type: 'VARCHAR(36)', nullable: false, isPrimary: false, isForeign: true, foreignTable: neuronTable, foreignColumn: 'id' },
      { name: 'type', type: 'VARCHAR(20)', nullable: false, isPrimary: false, isForeign: false },
      { name: 'weight', type: 'FLOAT', nullable: false, isPrimary: false, isForeign: false },
      { name: 'bidirectional', type: 'BOOLEAN', nullable: false, isPrimary: false, isForeign: false, defaultValue: false },
      { name: 'activation_count', type: 'INT', nullable: false, isPrimary: false, isForeign: false, defaultValue: 0 },
      { name: 'created_at', type: 'TIMESTAMP', nullable: true, isPrimary: false, isForeign: false },
      { name: 'updated_at', type: 'TIMESTAMP', nullable: true, isPrimary: false, isForeign: false },
    ],
    primaryKey: ['id'],
    foreignKeys: [
      { column: 'source_id', refTable: neuronTable, refColumn: 'id' },
      { column: 'target_id', refTable: neuronTable, refColumn: 'id' },
    ],
    rowCount: 0,
  };
}

/**
 * DB Bridge Service
 *
 * Provides bidirectional data transfer between external databases and NMT:
 * - Import: DB rows → NMT neurons (via IngestionService)
 * - Export: NMT neurons → DB tables/collections
 */
export class DBBridgeService {
  private connector: IDBConnector;
  private ingestionService: IngestionService;
  private neuronStore: INeuronStore;

  constructor(
    connector: IDBConnector,
    ingestionService: IngestionService,
    neuronStore: INeuronStore,
  ) {
    this.connector = connector;
    this.ingestionService = ingestionService;
    this.neuronStore = neuronStore;
  }

  /**
   * Import rows from an external DB table into NMT as neurons
   */
  async importTable(options: ImportOptions): Promise<ImportResult> {
    const startTime = Date.now();
    const result: ImportResult = {
      neuronsCreated: 0,
      synapsesCreated: 0,
      rowsProcessed: 0,
      errors: [],
      duration: 0,
      sourceTable: options.table,
    };

    // Get table schema for metadata
    const tableSchema = await this.connector.getTableSchema(options.table);
    const baseTags = [
      'db-import',
      options.table,
      ...(options.tags ?? []),
    ];

    // Track PK → neuronId for FK-based synapse creation
    const pkToNeuronId = new Map<string, UUID>();
    const fkRelations: Array<{ neuronId: UUID; fkColumn: string; fkValue: string }> = [];

    // Cap error list to prevent memory exhaustion on pathological inputs
    const MAX_ERRORS = 1000;

    // Stream rows in batches
    for await (const batch of this.connector.readRows(options.table, {
      limit: options.limit,
      batchSize: options.batchSize ?? 1000,
    })) {
      for (const row of batch) {
        try {
          const text = rowToText(row, options.table);
          const sourceType = `db:${options.table}`;
          const safeRow = this.sanitizeRowForStorage(row);

          const neuron = await this.ingestionService.ingestText(text, {
            sourceType,
            tags: baseTags,
            autoConnect: options.autoConnect ?? true,
            sourceRow: safeRow,
            sourceColumns: tableSchema.columns.map(c => ({
              name: c.name,
              type: c.type,
              nullable: c.nullable,
              isPrimary: c.isPrimary,
              isForeign: c.isForeign,
              foreignTable: c.foreignTable,
              foreignColumn: c.foreignColumn,
              defaultValue: c.defaultValue,
              autoIncrement: c.autoIncrement,
              isUnique: c.isUnique,
              maxLength: c.maxLength,
              extra: c.extra,
            })),
            sourceForeignKeys: tableSchema.foreignKeys.map(fk => ({
              column: fk.column,
              refTable: fk.refTable,
              refColumn: fk.refColumn,
            })),
            sourceIndexes: tableSchema.indexes?.map(idx => ({
              name: idx.name,
              columns: idx.columns,
              unique: idx.unique,
            })),
            sourceChecks: tableSchema.checks?.map(chk => ({
              name: chk.name,
              clause: chk.clause,
            })),
            sourceTriggers: tableSchema.triggers?.map(trig => ({
              name: trig.name,
              timing: trig.timing,
              event: trig.event,
              body: trig.body,
            })),
            sourceTable: options.table,
            sourceEngine: tableSchema.engine,
            sourceCharset: tableSchema.charset,
          });

          result.neuronsCreated++;
          result.rowsProcessed++;

          // Track PK mapping
          const pkValue = this.extractPrimaryKey(row, tableSchema);
          if (pkValue) {
            pkToNeuronId.set(pkValue, neuron.id);
          }

          // Track FK relations for later synapse creation
          for (const fk of tableSchema.foreignKeys) {
            const fkVal = row[fk.column];
            if (fkVal !== null && fkVal !== undefined) {
              fkRelations.push({
                neuronId: neuron.id,
                fkColumn: fk.column,
                fkValue: `${fk.refTable}:${String(fkVal)}`,
              });
            }
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          if (result.errors.length < MAX_ERRORS) {
            result.errors.push(`Row ${result.rowsProcessed}: ${msg}`);
          }
          result.rowsProcessed++;
        }
      }

      // Process FK synapses accumulated this batch to limit memory
      if (options.autoConnect !== false && fkRelations.length > 0) {
        for (const rel of fkRelations) {
          const targetNeuronId = pkToNeuronId.get(rel.fkValue);
          if (targetNeuronId) {
            try {
              await this.neuronStore.createSynapse(
                rel.neuronId,
                targetNeuronId,
                'ASSOCIATIVE',
                0.8,
                false
              );
              result.synapsesCreated++;
            } catch {
              // Synapse creation may fail if target doesn't exist yet
            }
          }
        }
        fkRelations.length = 0;
      }
    }

    // Final pass: process any remaining FK relations from last batch
    if (options.autoConnect !== false) {
      for (const rel of fkRelations) {
        const targetNeuronId = pkToNeuronId.get(rel.fkValue);
        if (targetNeuronId) {
          try {
            await this.neuronStore.createSynapse(
              rel.neuronId,
              targetNeuronId,
              'ASSOCIATIVE',
              0.8,
              false
            );
            result.synapsesCreated++;
          } catch {
            // Synapse creation may fail if target doesn't exist
          }
        }
      }
    }

    result.duration = Date.now() - startTime;
    return result;
  }

  /**
   * Export NMT neurons to an external DB
   */
  async exportNeurons(options: ExportOptions = {}): Promise<ExportResult> {
    const startTime = Date.now();
    const result: ExportResult = {
      neuronsExported: 0,
      synapsesExported: 0,
      tablesCreated: [],
      duration: 0,
      sourceDataRestored: 0,
    };

    const neuronTable = options.table ?? 'nmt_neurons';
    const synapseTable = `${neuronTable}_synapses`;
    const includeEmbeddings = options.includeEmbeddings ?? true;
    const includeSynapses = options.includeSynapses ?? true;
    const restoreSourceData = options.restoreSourceData ?? false;

    // Get all neuron IDs (optionally filtered by tags)
    const allIds = await this.neuronStore.getAllNeuronIds();

    // Determine table schema based on mode
    let tableCreated = false;
    if (restoreSourceData) {
      // Find first neuron with source columns to create source-schema table
      for (const id of allIds) {
        const neuron = await this.neuronStore.getNeuron(id);
        if (neuron?.metadata.sourceColumns && neuron.metadata.sourceColumns.length > 0) {
          const cols = neuron.metadata.sourceColumns;
          const fks = neuron.metadata.sourceForeignKeys ?? [];
          const idxs = neuron.metadata.sourceIndexes ?? [];
          const sourceSchema: TableSchema = {
            name: neuronTable,
            columns: cols.map(c => ({
              name: c.name,
              type: c.type,
              nullable: c.nullable,
              isPrimary: c.isPrimary,
              isForeign: c.isForeign ?? false,
              foreignTable: c.foreignTable,
              foreignColumn: c.foreignColumn,
              defaultValue: c.defaultValue,
              autoIncrement: c.autoIncrement,
              isUnique: c.isUnique,
              maxLength: c.maxLength,
              extra: c.extra,
            })),
            primaryKey: cols
              .filter(c => c.isPrimary)
              .map(c => c.name),
            foreignKeys: fks.map(fk => ({
              column: fk.column,
              refTable: fk.refTable,
              refColumn: fk.refColumn,
            })),
            indexes: idxs.map(idx => ({
              name: idx.name,
              columns: idx.columns,
              unique: idx.unique,
            })),
            checks: (neuron.metadata.sourceChecks ?? []).map(chk => ({
              name: chk.name,
              clause: chk.clause,
            })),
            triggers: (neuron.metadata.sourceTriggers ?? []).map(trig => ({
              name: trig.name,
              timing: trig.timing,
              event: trig.event,
              body: trig.body,
            })),
            engine: neuron.metadata.sourceEngine,
            charset: neuron.metadata.sourceCharset,
            rowCount: 0,
          };
          if (!(await this.connector.tableExists(neuronTable))) {
            await this.connector.createTable(sourceSchema);
            result.tablesCreated.push(neuronTable);
          }
          tableCreated = true;
          break;
        }
      }
    }

    // Fallback to neuron metadata schema
    if (!tableCreated) {
      const neuronSchema = getNeuronTableSchema(neuronTable, includeEmbeddings);
      if (!(await this.connector.tableExists(neuronTable))) {
        await this.connector.createTable(neuronSchema);
        result.tablesCreated.push(neuronTable);
      }
    }

    // Export neurons in batches
    const batchSize = 500;
    const neuronRows: DBRow[] = [];
    const synapseIds = new Set<UUID>();

    // When restoreSourceData is on, non-source neurons go to a separate fallback table
    const fallbackTable = `${neuronTable}_nmt_meta`;
    const fallbackRows: DBRow[] = [];
    let fallbackTableCreated = false;

    for (const id of allIds) {
      const neuron = await this.neuronStore.getNeuron(id);
      if (!neuron) continue;

      // Filter by tags if specified
      if (options.tags && options.tags.length > 0) {
        const hasTags = options.tags.some((t) =>
          neuron.metadata.tags.includes(t)
        );
        if (!hasTags) continue;
      }

      // Use source data if available and requested
      if (restoreSourceData && neuron.metadata.sourceRow) {
        neuronRows.push(this.desanitizeRow(neuron.metadata.sourceRow));
        result.sourceDataRestored!++;
      } else if (restoreSourceData && tableCreated) {
        // Source-schema table active but this neuron has no sourceRow — send to fallback
        if (!fallbackTableCreated) {
          const fbSchema = getNeuronTableSchema(fallbackTable, includeEmbeddings);
          if (!(await this.connector.tableExists(fallbackTable))) {
            await this.connector.createTable(fbSchema);
            result.tablesCreated.push(fallbackTable);
          }
          fallbackTableCreated = true;
        }
        fallbackRows.push(neuronToRow(neuron, includeEmbeddings));
      } else {
        neuronRows.push(neuronToRow(neuron, includeEmbeddings));
      }

      // Collect synapse IDs
      if (includeSynapses) {
        for (const synId of neuron.outgoingSynapses) {
          synapseIds.add(synId);
        }
      }

      // Flush source rows batch
      if (neuronRows.length >= batchSize) {
        await this.connector.writeRows(neuronTable, neuronRows);
        result.neuronsExported += neuronRows.length;
        neuronRows.length = 0;
      }

      // Flush fallback rows batch
      if (fallbackRows.length >= batchSize) {
        await this.connector.writeRows(fallbackTable, fallbackRows);
        result.neuronsExported += fallbackRows.length;
        fallbackRows.length = 0;
      }

      if (options.limit && result.neuronsExported >= options.limit) break;
    }

    // Flush remaining source rows
    if (neuronRows.length > 0) {
      await this.connector.writeRows(neuronTable, neuronRows);
      result.neuronsExported += neuronRows.length;
    }

    // Flush remaining fallback rows
    if (fallbackRows.length > 0) {
      await this.connector.writeRows(fallbackTable, fallbackRows);
      result.neuronsExported += fallbackRows.length;
    }

    // Export synapses
    if (includeSynapses && synapseIds.size > 0) {
      const synSchema = getSynapseTableSchema(synapseTable, neuronTable);
      if (!(await this.connector.tableExists(synapseTable))) {
        await this.connector.createTable(synSchema);
        result.tablesCreated.push(synapseTable);
      }

      const synapseRows: DBRow[] = [];
      for (const synId of synapseIds) {
        const synapse = await this.neuronStore.getSynapse(synId);
        if (!synapse) continue;

        synapseRows.push(synapseToRow(synapse));

        if (synapseRows.length >= batchSize) {
          await this.connector.writeRows(synapseTable, synapseRows);
          result.synapsesExported += synapseRows.length;
          synapseRows.length = 0;
        }
      }

      if (synapseRows.length > 0) {
        await this.connector.writeRows(synapseTable, synapseRows);
        result.synapsesExported += synapseRows.length;
      }
    }

    result.duration = Date.now() - startTime;
    return result;
  }

  /**
   * Analyze the external database schema
   */
  async analyzeSchema(): Promise<DatabaseSchema> {
    return this.connector.getSchema();
  }

  /**
   * Extract primary key value from a row
   */
  private extractPrimaryKey(row: DBRow, schema: TableSchema): string | null {
    if (schema.primaryKey.length === 0) return null;

    const parts = schema.primaryKey.map((pk) => String(row[pk] ?? ''));
    return `${schema.name}:${parts.join(':')}`;
  }

  /**
   * Sanitize a DB row for JSON-safe storage in neuron metadata.
   * Converts Buffer/Date to tagged objects for lossless round-trip.
   */
  private sanitizeRowForStorage(row: DBRow): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
        result[key] = { __binary: true, data: Buffer.from(value).toString('base64') };
      } else if (value instanceof Date) {
        result[key] = { __date: true, data: value.toISOString() };
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  /**
   * Restore a sanitized row back to its original types.
   */
  private desanitizeRow(row: Record<string, unknown>): DBRow {
    const result: DBRow = {};
    for (const [key, value] of Object.entries(row)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const obj = value as Record<string, unknown>;
        if (obj.__binary && typeof obj.data === 'string') {
          result[key] = Buffer.from(obj.data, 'base64');
        } else if (obj.__date && typeof obj.data === 'string') {
          result[key] = new Date(obj.data);
        } else {
          result[key] = value;
        }
      } else {
        result[key] = value;
      }
    }
    return result;
  }
}
