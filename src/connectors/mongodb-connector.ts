/**
 * MongoDB Connector
 * @module connectors/mongodb-connector
 */

import type {
  IDBConnector,
  DBConnectionConfig,
  DatabaseSchema,
  TableSchema,
  TableIndex,
  CheckConstraint,
  ColumnSchema,
  DBRow,
  ReadOptions,
} from './types.js';

/**
 * MongoDB connector using the mongodb driver
 */
export class MongoDBConnector implements IDBConnector {
  private client: any = null;
  private db: any = null;
  private config: DBConnectionConfig | null = null;

  async connect(config: DBConnectionConfig): Promise<void> {
    this.config = config;

    let mongodb: any;
    try {
      mongodb = await import('mongodb');
    } catch {
      throw new Error(
        'mongodb package not installed. Run: npm install mongodb'
      );
    }

    const uri =
      config.uri ??
      `mongodb://${config.user ? `${encodeURIComponent(config.user)}:${encodeURIComponent(config.password ?? '')}@` : ''}${config.host ?? 'localhost'}:${config.port ?? 27017}`;

    this.client = new mongodb.MongoClient(uri, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      ...config.options,
    });
    await this.client.connect();
    this.db = this.client.db(config.database);

    // Test connection
    await this.db.command({ ping: 1 });
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
    }
  }

  async getSchema(): Promise<DatabaseSchema> {
    this.ensureConnected();

    const collections = await this.db.listCollections().toArray();
    const tables: TableSchema[] = [];

    for (const col of collections) {
      if (col.name.startsWith('system.')) continue;
      const schema = await this.getTableSchema(col.name);
      tables.push(schema);
    }

    return {
      name: this.config!.database,
      tables,
      driver: this.config!.driver,
    };
  }

  async getTableSchema(table: string): Promise<TableSchema> {
    this.ensureConnected();

    const collection = this.db.collection(table);
    const count = await collection.countDocuments();

    // Sample documents to infer schema
    const samples = await collection.find().limit(100).toArray();

    const fieldTypes = new Map<string, Set<string>>();
    for (const doc of samples) {
      for (const [key, value] of Object.entries(doc)) {
        if (!fieldTypes.has(key)) {
          fieldTypes.set(key, new Set());
        }
        fieldTypes.get(key)!.add(this.inferType(value));
      }
    }

    // Read indexes
    const rawIndexes = await collection.indexes();
    const indexes: TableIndex[] = [];
    const uniqueSingleCols = new Set<string>();
    for (const idx of rawIndexes as any[]) {
      if (idx.name === '_id_') continue; // Skip default _id index
      const cols = Object.keys(idx.key);
      const unique = !!idx.unique;
      indexes.push({ name: idx.name, columns: cols, unique });
      if (unique && cols.length === 1) {
        uniqueSingleCols.add(cols[0]);
      }
    }

    // Read collection validator (MongoDB's CHECK equivalent)
    let checks: CheckConstraint[] = [];
    try {
      const colls = await this.db
        .listCollections({ name: table })
        .toArray();
      const validator = colls[0]?.options?.validator;
      if (validator) {
        // Store entire validator as a single CHECK-like constraint
        checks = [{
          name: `${table}_validator`,
          clause: JSON.stringify(validator),
        }];
      }
    } catch {
      // Validator read failed
    }

    const columns: ColumnSchema[] = [];
    for (const [name, types] of fieldTypes) {
      columns.push({
        name,
        type: Array.from(types).join('|'),
        nullable: samples.some(
          (d: Record<string, unknown>) => d[name] === null || d[name] === undefined
        ),
        isPrimary: name === '_id',
        isForeign: false,
        isUnique: uniqueSingleCols.has(name),
      });
    }

    return {
      name: table,
      columns,
      primaryKey: ['_id'],
      foreignKeys: [],
      indexes,
      checks,
      rowCount: count,
    };
  }

  async *readRows(
    table: string,
    options: ReadOptions = {}
  ): AsyncGenerator<DBRow[], void, unknown> {
    this.ensureConnected();

    const collection = this.db.collection(table);
    const batchSize = options.batchSize ?? 1000;
    const limit = options.limit;
    let query: Record<string, unknown> = {};
    if (options.where) {
      try {
        const parsed = JSON.parse(options.where);
        // Sanitize: reject MongoDB operators ($gt, $where, etc.) to prevent NoSQL injection
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          for (const key of Object.keys(parsed)) {
            if (key.startsWith('$')) {
              throw new Error(`MongoDB query operators like '${key}' are not allowed in where filters`);
            }
          }
          query = parsed;
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes('not allowed')) throw e;
        // Ignore invalid JSON filter
      }
    }

    let cursor = collection.find(query).batchSize(batchSize);
    if (options.offset) {
      cursor = cursor.skip(options.offset);
    }
    if (limit) {
      cursor = cursor.limit(limit);
    }

    let batch: DBRow[] = [];

    for await (const doc of cursor) {
      // Convert _id to string
      const row: DBRow = { ...doc };
      if (row._id && typeof row._id === 'object' && row._id.toString) {
        row._id = row._id.toString();
      }
      batch.push(row);

      if (batch.length >= batchSize) {
        yield batch;
        batch = [];
      }
    }

    if (batch.length > 0) {
      yield batch;
    }
  }

  async writeRows(table: string, rows: DBRow[]): Promise<number> {
    this.ensureConnected();

    if (rows.length === 0) return 0;

    const collection = this.db.collection(table);
    const batchSize = 1000;
    let inserted = 0;

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const docs = batch.map((row) => {
        const doc: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(row)) {
          // Use _id for id field in MongoDB
          if (key === 'id') {
            doc._id = value;
          } else {
            doc[key] = value;
          }
        }
        return doc;
      });

      const result = await collection.insertMany(docs, { ordered: false });
      inserted += result.insertedCount;
    }

    return inserted;
  }

  async createTable(schema: TableSchema): Promise<void> {
    this.ensureConnected();

    const exists = await this.tableExists(schema.name);

    // Create collection with validator if CHECK constraints exist
    const validator = this.extractValidator(schema);
    if (!exists) {
      const createOpts: Record<string, unknown> = {};
      if (validator) {
        createOpts.validator = validator;
      }
      await this.db.createCollection(schema.name, createOpts);
    } else if (validator) {
      // Collection exists — update validator
      await this.db.command({
        collMod: schema.name,
        validator,
        validationLevel: 'moderate',
      });
    }

    const collection = this.db.collection(schema.name);

    // Create indexes from schema.indexes (restored from source)
    if (schema.indexes) {
      for (const idx of schema.indexes) {
        const key: Record<string, number> = {};
        for (const col of idx.columns) {
          key[col] = 1;
        }
        await collection.createIndex(key, {
          name: idx.name,
          unique: idx.unique,
        });
      }
    }

    // Fallback: create indexes for FK columns not covered by schema.indexes
    const indexedCols = new Set(
      (schema.indexes ?? []).flatMap((idx) => idx.columns)
    );
    for (const col of schema.columns) {
      if (col.isForeign && !indexedCols.has(col.name)) {
        await collection.createIndex({ [col.name]: 1 });
      }
    }
  }

  /**
   * Extract MongoDB validator from CHECK constraints.
   * If the clause is JSON, parse it back as a validator object.
   */
  private extractValidator(schema: TableSchema): Record<string, unknown> | null {
    if (!schema.checks || schema.checks.length === 0) return null;
    // Use the first check constraint as the validator
    try {
      return JSON.parse(schema.checks[0].clause);
    } catch {
      return null;
    }
  }

  async tableExists(table: string): Promise<boolean> {
    this.ensureConnected();

    const collections = await this.db
      .listCollections({ name: table })
      .toArray();
    return collections.length > 0;
  }

  private ensureConnected(): void {
    if (!this.db) {
      throw new Error('Not connected. Call connect() first.');
    }
  }

  private inferType(value: unknown): string {
    if (value === null || value === undefined) return 'null';
    if (Array.isArray(value)) return 'array';
    if (value instanceof Date) return 'date';
    if (typeof value === 'object' && value !== null) {
      if (value.constructor?.name === 'ObjectId') return 'objectId';
      if (value.constructor?.name === 'Binary') return 'binary';
      return 'object';
    }
    return typeof value;
  }
}
