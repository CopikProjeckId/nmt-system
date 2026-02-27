/**
 * DB Connectors — Factory and exports
 * @module connectors
 */

export type {
  DriverType,
  DBConnectionConfig,
  ColumnSchema,
  TableSchema,
  DatabaseSchema,
  DBRow,
  ReadOptions,
  IDBConnector,
  ImportOptions,
  ImportResult,
  ExportOptions,
  ExportResult,
} from './types.js';

/**
 * Create a database connector for the given driver type.
 * Drivers are loaded lazily to avoid requiring unused optional dependencies.
 */
export async function createConnector(driver: string): Promise<import('./types.js').IDBConnector> {
  switch (driver) {
    case 'mysql':
    case 'mariadb': {
      const { MySQLConnector } = await import('./mysql-connector.js');
      return new MySQLConnector();
    }
    case 'mongodb': {
      const { MongoDBConnector } = await import('./mongodb-connector.js');
      return new MongoDBConnector();
    }
    default:
      throw new Error(
        `Unsupported driver: ${driver}. Available: mysql, mariadb, mongodb`
      );
  }
}
