/**
 * MySQL/MariaDB Connector
 * @module connectors/mysql-connector
 */

import type {
  IDBConnector,
  DBConnectionConfig,
  DatabaseSchema,
  TableSchema,
  TableIndex,
  CheckConstraint,
  TableTrigger,
  ColumnSchema,
  DBRow,
  ReadOptions,
} from './types.js';

/**
 * MySQL/MariaDB connector using mysql2/promise
 */
export class MySQLConnector implements IDBConnector {
  private pool: any = null;
  private config: DBConnectionConfig | null = null;

  async connect(config: DBConnectionConfig): Promise<void> {
    this.config = config;

    let mysql2: any;
    try {
      mysql2 = await import('mysql2/promise');
    } catch {
      throw new Error(
        'mysql2 package not installed. Run: npm install mysql2'
      );
    }

    this.pool = mysql2.createPool({
      host: config.host ?? 'localhost',
      port: config.port ?? 3306,
      user: config.user ?? 'root',
      password: config.password ?? '',
      database: config.database,
      waitForConnections: true,
      connectionLimit: 10,
      connectTimeout: 10000,
      ...config.options,
    });

    // Test connection
    const conn = await this.pool.getConnection();
    conn.release();
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  async getSchema(): Promise<DatabaseSchema> {
    this.ensureConnected();

    const [tables] = await this.pool.query(
      `SELECT TABLE_NAME, TABLE_ROWS FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`,
      [this.config!.database]
    );

    const tableSchemas: TableSchema[] = [];
    for (const t of tables as any[]) {
      const schema = await this.getTableSchema(t.TABLE_NAME);
      schema.rowCount = Number(t.TABLE_ROWS) || 0;
      tableSchemas.push(schema);
    }

    return {
      name: this.config!.database,
      tables: tableSchemas,
      driver: this.config!.driver,
    };
  }

  async getTableSchema(table: string): Promise<TableSchema> {
    this.ensureConnected();
    this.validateIdentifier(table, 'table name');

    // Get columns (COLUMN_TYPE preserves full precision: varchar(255), decimal(10,2), enum(...))
    const [columns] = await this.pool.query(
      `SELECT COLUMN_NAME, COLUMN_TYPE, DATA_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT,
              EXTRA, CHARACTER_MAXIMUM_LENGTH
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [this.config!.database, table]
    );

    // Get foreign keys
    const [fks] = await this.pool.query(
      `SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
         AND REFERENCED_TABLE_NAME IS NOT NULL`,
      [this.config!.database, table]
    );

    // Get indexes (non-primary)
    const [idxRows] = await this.pool.query(
      `SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE, SEQ_IN_INDEX
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
         AND INDEX_NAME != 'PRIMARY'
       ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
      [this.config!.database, table]
    );

    // Get table engine & charset
    const [tableInfo] = await this.pool.query(
      `SELECT ENGINE, TABLE_COLLATION
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
      [this.config!.database, table]
    );
    const engine = (tableInfo as any[])[0]?.ENGINE as string | undefined;
    const collation = (tableInfo as any[])[0]?.TABLE_COLLATION as string | undefined;
    const charset = collation?.split('_')[0]; // e.g. utf8mb4_general_ci → utf8mb4

    const fkMap = new Map<string, { refTable: string; refColumn: string }>();
    for (const fk of fks as any[]) {
      fkMap.set(fk.COLUMN_NAME, {
        refTable: fk.REFERENCED_TABLE_NAME,
        refColumn: fk.REFERENCED_COLUMN_NAME,
      });
    }

    // Build index map (INDEX_NAME → { columns, unique })
    const indexMap = new Map<string, { columns: string[]; unique: boolean }>();
    for (const row of idxRows as any[]) {
      const name = row.INDEX_NAME as string;
      if (!indexMap.has(name)) {
        indexMap.set(name, { columns: [], unique: row.NON_UNIQUE === 0 });
      }
      indexMap.get(name)!.columns.push(row.COLUMN_NAME);
    }

    // Collect unique column set from indexes for isUnique single-column detection
    const uniqueSingleCols = new Set<string>();
    for (const [, idx] of indexMap) {
      if (idx.unique && idx.columns.length === 1) {
        uniqueSingleCols.add(idx.columns[0]);
      }
    }

    const columnSchemas: ColumnSchema[] = (columns as any[]).map((col) => {
      const fk = fkMap.get(col.COLUMN_NAME);
      const extra = col.EXTRA as string;
      return {
        name: col.COLUMN_NAME,
        type: (col.COLUMN_TYPE as string).toUpperCase(),
        nullable: col.IS_NULLABLE === 'YES',
        isPrimary: col.COLUMN_KEY === 'PRI',
        isForeign: !!fk,
        foreignTable: fk?.refTable,
        foreignColumn: fk?.refColumn,
        defaultValue: col.COLUMN_DEFAULT,
        autoIncrement: extra?.includes('auto_increment') ?? false,
        isUnique: col.COLUMN_KEY === 'UNI' || uniqueSingleCols.has(col.COLUMN_NAME),
        maxLength: col.CHARACTER_MAXIMUM_LENGTH != null ? Number(col.CHARACTER_MAXIMUM_LENGTH) : undefined,
        extra: extra || undefined,
      };
    });

    const primaryKey = columnSchemas
      .filter((c) => c.isPrimary)
      .map((c) => c.name);

    const foreignKeys = columnSchemas
      .filter((c) => c.isForeign)
      .map((c) => ({
        column: c.name,
        refTable: c.foreignTable!,
        refColumn: c.foreignColumn!,
      }));

    const indexes: TableIndex[] = Array.from(indexMap.entries()).map(([name, idx]) => ({
      name,
      columns: idx.columns,
      unique: idx.unique,
    }));

    // Get CHECK constraints (MySQL 8.0.16+, graceful fallback)
    let checks: CheckConstraint[] = [];
    try {
      const [checkRows] = await this.pool.query(
        `SELECT cc.CONSTRAINT_NAME, cc.CHECK_CLAUSE
         FROM INFORMATION_SCHEMA.CHECK_CONSTRAINTS cc
         JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
           ON cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
           AND cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
         WHERE tc.TABLE_SCHEMA = ? AND tc.TABLE_NAME = ?
           AND tc.CONSTRAINT_TYPE = 'CHECK'`,
        [this.config!.database, table]
      );
      checks = (checkRows as any[]).map((r) => ({
        name: r.CONSTRAINT_NAME,
        clause: r.CHECK_CLAUSE,
      }));
    } catch {
      // CHECK_CONSTRAINTS not available (MySQL < 8.0.16)
    }

    // Get triggers
    let triggers: TableTrigger[] = [];
    try {
      const [trigRows] = await this.pool.query(
        `SELECT TRIGGER_NAME, ACTION_TIMING, EVENT_MANIPULATION, ACTION_STATEMENT
         FROM INFORMATION_SCHEMA.TRIGGERS
         WHERE TRIGGER_SCHEMA = ? AND EVENT_OBJECT_TABLE = ?`,
        [this.config!.database, table]
      );
      triggers = (trigRows as any[]).map((r) => ({
        name: r.TRIGGER_NAME,
        timing: r.ACTION_TIMING as 'BEFORE' | 'AFTER',
        event: r.EVENT_MANIPULATION as 'INSERT' | 'UPDATE' | 'DELETE',
        body: r.ACTION_STATEMENT,
      }));
    } catch {
      // Triggers query failed (permissions or version)
    }

    // Get row count
    const [[countResult]] = await this.pool.query(
      `SELECT COUNT(*) as cnt FROM \`${table}\``
    );

    return {
      name: table,
      columns: columnSchemas,
      primaryKey,
      foreignKeys,
      indexes,
      checks,
      triggers,
      engine,
      charset,
      rowCount: Number((countResult as any).cnt),
    };
  }

  async *readRows(
    table: string,
    options: ReadOptions = {}
  ): AsyncGenerator<DBRow[], void, unknown> {
    this.ensureConnected();
    this.validateIdentifier(table, 'table name');

    const batchSize = options.batchSize ?? 1000;
    const limit = options.limit;
    let offset = options.offset ?? 0;
    let totalRead = 0;

    while (true) {
      const currentBatch = limit
        ? Math.min(batchSize, limit - totalRead)
        : batchSize;

      if (currentBatch <= 0) break;

      let query = `SELECT * FROM \`${table}\``;
      const params: unknown[] = [];

      // Note: raw WHERE clause is intentionally not supported to prevent SQL injection.
      // Use structured filters or application-level filtering instead.

      query += ` LIMIT ? OFFSET ?`;
      params.push(currentBatch, offset);

      const [rows] = await this.pool.query(query, params);
      const batch = rows as DBRow[];

      if (batch.length === 0) break;

      yield batch;

      totalRead += batch.length;
      offset += batch.length;

      if (batch.length < currentBatch) break;
    }
  }

  async writeRows(table: string, rows: DBRow[]): Promise<number> {
    this.ensureConnected();
    this.validateIdentifier(table, 'table name');

    if (rows.length === 0) return 0;

    const columns = Object.keys(rows[0]);
    const placeholders = columns.map(() => '?').join(', ');
    const columnList = columns.map((c) => `\`${c}\``).join(', ');

    let inserted = 0;
    const batchSize = 500;

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const values = batch.map((row) => columns.map((c) => row[c]));

      const multiPlaceholders = batch
        .map(() => `(${placeholders})`)
        .join(', ');

      await this.pool.query(
        `INSERT INTO \`${table}\` (${columnList}) VALUES ${multiPlaceholders}`,
        values.flat()
      );

      inserted += batch.length;
    }

    return inserted;
  }

  async createTable(schema: TableSchema): Promise<void> {
    this.ensureConnected();
    this.validateIdentifier(schema.name, 'table name');

    const columnDefs = schema.columns.map((col) => {
      let def = `\`${col.name}\` ${this.mapColumnType(col.type)}`;
      if (!col.nullable) def += ' NOT NULL';
      if (col.autoIncrement) def += ' AUTO_INCREMENT';
      if (col.defaultValue !== undefined && col.defaultValue !== null) {
        def += ` DEFAULT ${this.escapeDefault(col.defaultValue)}`;
      }
      // Restore ON UPDATE clause from extra (e.g. "on update CURRENT_TIMESTAMP")
      if (col.extra) {
        const extraLower = col.extra.toLowerCase();
        const onUpdateIdx = extraLower.indexOf('on update');
        if (onUpdateIdx !== -1) {
          def += ` ${col.extra.substring(onUpdateIdx)}`;
        }
      }
      return def;
    });

    if (schema.primaryKey.length > 0) {
      columnDefs.push(
        `PRIMARY KEY (${schema.primaryKey.map((k) => `\`${k}\``).join(', ')})`
      );
    }

    // Add UNIQUE/INDEX constraints from indexes
    if (schema.indexes) {
      for (const idx of schema.indexes) {
        const cols = idx.columns.map((c) => `\`${c}\``).join(', ');
        if (idx.unique) {
          columnDefs.push(`UNIQUE KEY \`${idx.name}\` (${cols})`);
        } else {
          columnDefs.push(`KEY \`${idx.name}\` (${cols})`);
        }
      }
    }

    for (const fk of schema.foreignKeys) {
      columnDefs.push(
        `FOREIGN KEY (\`${fk.column}\`) REFERENCES \`${fk.refTable}\`(\`${fk.refColumn}\`)`
      );
    }

    // Add CHECK constraints inline
    if (schema.checks) {
      for (const chk of schema.checks) {
        columnDefs.push(`CONSTRAINT \`${chk.name}\` CHECK (${chk.clause})`);
      }
    }

    const engine = schema.engine ?? 'InnoDB';
    const charset = schema.charset ?? 'utf8mb4';
    const ddl = `CREATE TABLE IF NOT EXISTS \`${schema.name}\` (\n  ${columnDefs.join(',\n  ')}\n) ENGINE=${engine} DEFAULT CHARSET=${charset}`;

    await this.pool.query(ddl);

    // Create triggers (must be separate statements after table creation)
    if (schema.triggers) {
      for (const trig of schema.triggers) {
        const trigDdl = `CREATE TRIGGER \`${trig.name}\` ${trig.timing} ${trig.event} ON \`${schema.name}\` FOR EACH ROW ${trig.body}`;
        await this.pool.query(trigDdl);
      }
    }
  }

  async tableExists(table: string): Promise<boolean> {
    this.ensureConnected();
    this.validateIdentifier(table, 'table name');

    const [rows] = await this.pool.query(
      `SELECT 1 FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
      [this.config!.database, table]
    );

    return (rows as any[]).length > 0;
  }

  private ensureConnected(): void {
    if (!this.pool) {
      throw new Error('Not connected. Call connect() first.');
    }
  }

  /**
   * Validate identifier (table/column name) to prevent SQL injection.
   * Only allows alphanumeric, underscores, hyphens, and dots.
   */
  private validateIdentifier(name: string, label: string = 'identifier'): void {
    if (!name || !/^[a-zA-Z0-9_\-\.]+$/.test(name)) {
      throw new Error(`Invalid ${label}: "${name}". Only alphanumeric, underscores, hyphens, and dots are allowed.`);
    }
  }

  private mapColumnType(type: string): string {
    const t = type.toUpperCase();
    // Pass through common MySQL types; add BLOB for binary
    const typeMap: Record<string, string> = {
      STRING: 'TEXT',
      NUMBER: 'DOUBLE',
      BOOLEAN: 'BOOLEAN',
      BLOB: 'LONGBLOB',
      ARRAY: 'JSON',
      OBJECT: 'JSON',
    };
    return typeMap[t] ?? t;
  }

  private escapeDefault(value: unknown): string {
    if (typeof value === 'string') {
      // Known SQL functions/keywords that must NOT be quoted
      const upper = value.toUpperCase().trim();
      if (
        upper === 'CURRENT_TIMESTAMP' ||
        upper === 'CURRENT_DATE' ||
        upper === 'CURRENT_TIME' ||
        upper === 'NOW()' ||
        upper === 'UUID()' ||
        upper === 'NULL' ||
        upper === 'TRUE' ||
        upper === 'FALSE' ||
        upper.startsWith('(')  // Expression defaults e.g. (UUID()), (0)
      ) {
        return value;
      }
      return `'${value.replace(/'/g, "''")}'`;
    }
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    return 'NULL';
  }
}
