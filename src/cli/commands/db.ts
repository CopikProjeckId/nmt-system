/**
 * DB Commands — Import/Export between external databases and NMT
 * @module cli/commands/db
 */

import type { DBConnectionConfig, DriverType } from '../../connectors/types.js';

/**
 * Parse DB connection args from CLI arguments
 */
export function parseDBArgs(args: string[]): {
  subCommand: string;
  config: DBConnectionConfig;
  table?: string;
  limit?: number;
  batchSize?: number;
  tags?: string[];
  includeEmbeddings?: boolean;
  includeSynapses?: boolean;
} {
  const subCommand = args[0] ?? 'help';
  let driver: DriverType = 'mysql';
  let host = 'localhost';
  let port: number | undefined;
  let user: string | undefined;
  let password: string | undefined;
  let database = '';
  let uri: string | undefined;
  let table: string | undefined;
  let limit: number | undefined;
  let batchSize: number | undefined;
  let tags: string[] | undefined;
  let includeEmbeddings = true;
  let includeSynapses = true;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case '--driver':
        driver = next as DriverType;
        i++;
        break;
      case '--host':
        host = next;
        i++;
        break;
      case '--port':
        port = parseInt(next, 10);
        i++;
        break;
      case '--user':
      case '-u':
        user = next;
        i++;
        break;
      case '--password':
      case '-p':
        password = next;
        i++;
        break;
      case '--database':
      case '--db':
      case '-d':
        database = next;
        i++;
        break;
      case '--uri':
        uri = next;
        i++;
        break;
      case '--table':
      case '--collection':
      case '-t':
        table = next;
        i++;
        break;
      case '--limit':
        limit = parseInt(next, 10);
        i++;
        break;
      case '--batch':
        batchSize = parseInt(next, 10);
        i++;
        break;
      case '--tags':
        tags = next.split(',').map((t) => t.trim());
        i++;
        break;
      case '--no-embeddings':
        includeEmbeddings = false;
        break;
      case '--no-synapses':
        includeSynapses = false;
        break;
    }
  }

  return {
    subCommand,
    config: {
      driver,
      host,
      port: port ?? (driver === 'mongodb' ? 27017 : 3306),
      user,
      password,
      database,
      uri,
    },
    table,
    limit,
    batchSize,
    tags,
    includeEmbeddings,
    includeSynapses,
  };
}

/**
 * Format schema output for display
 */
export function formatSchema(schema: import('../../connectors/types.js').DatabaseSchema): string {
  let output = `\nDatabase: ${schema.name} (${schema.driver})\n`;
  output += '='.repeat(60) + '\n\n';

  for (const table of schema.tables) {
    output += `  Table: ${table.name} (${table.rowCount} rows)\n`;
    output += '  ' + '-'.repeat(50) + '\n';

    for (const col of table.columns) {
      let flags = '';
      if (col.isPrimary) flags += ' [PK]';
      if (col.isForeign) flags += ` [FK → ${col.foreignTable}.${col.foreignColumn}]`;
      if (!col.nullable) flags += ' NOT NULL';

      output += `    ${col.name.padEnd(25)} ${col.type.padEnd(15)}${flags}\n`;
    }
    output += '\n';
  }

  return output;
}

/**
 * Format import result for display
 */
export function formatImportResult(result: import('../../connectors/types.js').ImportResult): string {
  let output = '\nImport Complete\n';
  output += '='.repeat(40) + '\n';
  output += `  Source Table: ${result.sourceTable}\n`;
  output += `  Rows Processed: ${result.rowsProcessed}\n`;
  output += `  Neurons Created: ${result.neuronsCreated}\n`;
  output += `  Synapses Created: ${result.synapsesCreated}\n`;
  output += `  Duration: ${(result.duration / 1000).toFixed(1)}s\n`;

  if (result.errors.length > 0) {
    output += `  Errors: ${result.errors.length}\n`;
    for (const err of result.errors.slice(0, 5)) {
      output += `    - ${err}\n`;
    }
    if (result.errors.length > 5) {
      output += `    ... and ${result.errors.length - 5} more\n`;
    }
  }

  return output;
}

/**
 * Format export result for display
 */
export function formatExportResult(result: import('../../connectors/types.js').ExportResult): string {
  let output = '\nExport Complete\n';
  output += '='.repeat(40) + '\n';
  output += `  Neurons Exported: ${result.neuronsExported}\n`;
  output += `  Synapses Exported: ${result.synapsesExported}\n`;
  output += `  Tables Created: ${result.tablesCreated.join(', ') || 'none (existing)'}\n`;
  output += `  Duration: ${(result.duration / 1000).toFixed(1)}s\n`;

  return output;
}

const DB_HELP = `
nmt db <subcommand> [options]

Subcommands:
  import    Import rows from external DB into NMT as neurons
  export    Export NMT neurons to external DB tables
  schema    Analyze external DB schema

Connection Options:
  --driver <type>       mysql | mariadb | mongodb (default: mysql)
  --host <host>         Database host (default: localhost)
  --port <port>         Database port (default: 3306/27017)
  --user, -u <user>     Database user
  --password, -p <pwd>  Database password
  --database, -d <db>   Database name
  --uri <uri>           MongoDB connection URI (overrides host/port/user)

Import Options:
  --table, -t <name>    Table/collection to import
  --limit <n>           Max rows to import
  --batch <n>           Batch size (default: 1000)
  --tags <t1,t2>        Additional tags for imported neurons

Export Options:
  --table, -t <name>    Target table name (default: nmt_neurons)
  --tags <t1,t2>        Filter neurons by tags
  --limit <n>           Max neurons to export
  --no-embeddings       Skip embedding data
  --no-synapses         Skip synapse export

Examples:
  nmt db schema --driver mysql -u root -p secret -d mydb
  nmt db import --driver mysql -u root -p secret -d mydb -t users
  nmt db export --driver mongodb --uri mongodb://localhost:27017 -d nmt_export
`.trim();

export { DB_HELP };
