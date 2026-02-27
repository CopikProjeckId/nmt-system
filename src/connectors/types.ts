/**
 * DB Connector Types — Common interfaces for external database connectors
 * @module connectors/types
 */

/**
 * Supported database driver types
 */
export type DriverType = 'mysql' | 'mariadb' | 'mongodb';

/**
 * Database connection configuration
 */
export interface DBConnectionConfig {
  driver: DriverType;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database: string;
  uri?: string;
  options?: Record<string, unknown>;
}

/**
 * Column schema information
 */
export interface ColumnSchema {
  name: string;
  type: string;
  nullable: boolean;
  isPrimary: boolean;
  isForeign: boolean;
  foreignTable?: string;
  foreignColumn?: string;
  defaultValue?: unknown;
  autoIncrement?: boolean;
  isUnique?: boolean;
  maxLength?: number;
  extra?: string;
}

/**
 * Table index/unique constraint
 */
export interface TableIndex {
  name: string;
  columns: string[];
  unique: boolean;
}

/**
 * CHECK constraint
 */
export interface CheckConstraint {
  name: string;
  clause: string;
}

/**
 * Table trigger
 */
export interface TableTrigger {
  name: string;
  timing: 'BEFORE' | 'AFTER';
  event: 'INSERT' | 'UPDATE' | 'DELETE';
  body: string;
}

/**
 * Table/collection schema
 */
export interface TableSchema {
  name: string;
  columns: ColumnSchema[];
  primaryKey: string[];
  foreignKeys: Array<{
    column: string;
    refTable: string;
    refColumn: string;
  }>;
  indexes?: TableIndex[];
  checks?: CheckConstraint[];
  triggers?: TableTrigger[];
  engine?: string;
  charset?: string;
  rowCount: number;
}

/**
 * Full database schema
 */
export interface DatabaseSchema {
  name: string;
  tables: TableSchema[];
  driver: DriverType;
}

/**
 * Generic database row
 */
export interface DBRow {
  [column: string]: unknown;
}

/**
 * Read options for row streaming
 */
export interface ReadOptions {
  limit?: number;
  offset?: number;
  /**
   * @deprecated Raw where clauses are disabled to prevent SQL/NoSQL injection.
   * Use application-level filtering instead. MongoDB connector sanitizes operator keys.
   */
  where?: string;
  batchSize?: number;
}

/**
 * Database connector interface — all drivers implement this
 */
export interface IDBConnector {
  /** Connect to the database */
  connect(config: DBConnectionConfig): Promise<void>;

  /** Disconnect from the database */
  disconnect(): Promise<void>;

  /** Get full database schema (all tables/collections) */
  getSchema(): Promise<DatabaseSchema>;

  /** Get schema for a single table/collection */
  getTableSchema(table: string): Promise<TableSchema>;

  /** Stream rows in batches from a table */
  readRows(table: string, options?: ReadOptions): AsyncGenerator<DBRow[], void, unknown>;

  /** Write rows to a table (returns inserted count) */
  writeRows(table: string, rows: DBRow[]): Promise<number>;

  /** Create a table from schema definition */
  createTable(schema: TableSchema): Promise<void>;

  /** Check if a table exists */
  tableExists(table: string): Promise<boolean>;
}

/**
 * Import options
 */
export interface ImportOptions {
  table: string;
  limit?: number;
  batchSize?: number;
  tags?: string[];
  autoConnect?: boolean;
}

/**
 * Import result
 */
export interface ImportResult {
  neuronsCreated: number;
  synapsesCreated: number;
  rowsProcessed: number;
  errors: string[];
  duration: number;
  sourceTable: string;
}

/**
 * Export options
 */
export interface ExportOptions {
  table?: string;
  tags?: string[];
  limit?: number;
  includeEmbeddings?: boolean;
  includeSynapses?: boolean;
  /** Export original source columns instead of neuron metadata */
  restoreSourceData?: boolean;
}

/**
 * Export result
 */
export interface ExportResult {
  neuronsExported: number;
  synapsesExported: number;
  tablesCreated: string[];
  duration: number;
  /** Number of neurons exported with original source data */
  sourceDataRestored?: number;
}
