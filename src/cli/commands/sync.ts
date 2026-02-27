/**
 * Sync Commands - State synchronization CLI
 */

import * as fs from 'fs/promises';
import { resolve, normalize, isAbsolute } from 'path';
import type { CommandConfig, CommandResult, ProbabilisticContext } from '../types.js';
import { validateArgs, validationError, type CommandSchema } from '../utils/validators.js';

/**
 * Sanitize and validate file path to prevent directory traversal attacks
 */
function sanitizePath(inputPath: string, baseDir?: string): string {
  // Normalize the path to resolve .. and .
  const normalizedPath = normalize(inputPath);

  // Resolve to absolute path
  const absolutePath = isAbsolute(normalizedPath)
    ? normalizedPath
    : resolve(process.cwd(), normalizedPath);

  // If baseDir is specified, ensure path is within it
  if (baseDir) {
    const resolvedBase = resolve(baseDir);
    if (!absolutePath.startsWith(resolvedBase)) {
      throw new Error('Path must be within the allowed directory');
    }
  }

  return absolutePath;
}

/**
 * Extended context with sync capabilities
 */
interface SyncContext extends ProbabilisticContext {
  syncManager?: {
    getLocalState: () => {
      nodeId: string;
      merkleRoot: string | null;
      vectorClock: { toJSON: () => Record<string, number> };
      sequence: number;
      lastSync: string | null;
    };
    getLocalStateAsync: () => Promise<{
      nodeId: string;
      merkleRoot: string | null;
      vectorClock: { toJSON: () => Record<string, number> };
      sequence: number;
      lastSync: string | null;
    }>;
    getChangesSince: (seq: number) => Promise<Array<{
      sequence: number;
      type: string;
      operation: string;
      entityId: string;
      data: unknown;
      vectorClock: Record<string, number>;
      timestamp: string;
      nodeId?: string;
    }>>;
    getPeers: () => Array<{
      peerId: string;
      endpoint: string;
      lastSeen: number;
      lastSequence: number;
      status: string;
    }>;
    applyRemoteChanges: (changes: Array<{
      sequence: number;
      type: string;
      operation: string;
      entityId: string;
      data: unknown;
      vectorClock: Record<string, number>;
      timestamp: string;
      nodeId?: string;
    }>) => Promise<{
      applied: number;
      conflicts: number;
      resolved: string[];
    }>;
  };
  changeJournal?: {
    getStats: () => Promise<{
      totalEntries: number;
      oldestSequence: number;
      latestSequence: number;
      averageEntriesPerMinute: number;
    }>;
    getAfterSequence: (seq: number) => Promise<Array<{
      sequence: number;
      type: string;
      operation: string;
      entityId: string;
      data: unknown;
      timestamp: string;
    }>>;
  };
}

export async function cmdSync(
  args: string[],
  config: CommandConfig,
  ctx: SyncContext
): Promise<CommandResult> {
  const subCommand = args[0];
  const params = args.slice(1);

  switch (subCommand) {
    case 'status': {
      return syncStatus(ctx, config);
    }

    case 'changes': {
      const changesSchema: CommandSchema = {
        from: { type: 'number', min: 0, default: 0 },
        limit: { type: 'number', min: 1, max: 1000, default: 50 },
      };
      const validation = validateArgs(params, changesSchema, []);
      if (!validation.valid) {
        return validationError(validation.errors);
      }

      const from = validation.data!.from as number;
      const limit = validation.data!.limit as number;
      return syncChanges(ctx, config, from, limit);
    }

    case 'export': {
      const exportSchema: CommandSchema = {
        output: { type: 'string', default: 'sync-state.json' },
      };
      const validation = validateArgs(params, exportSchema, []);
      if (!validation.valid) {
        return validationError(validation.errors);
      }

      const output = validation.data!.output as string;
      return syncExport(ctx, config, output);
    }

    case 'import': {
      const importSchema: CommandSchema = {
        file: { type: 'string', required: true },
      };
      const validation = validateArgs(params, importSchema, ['file']);
      if (!validation.valid) {
        return validationError(validation.errors);
      }

      const file = validation.data!.file as string;
      return syncImport(ctx, config, file);
    }

    case 'peers': {
      return syncPeers(ctx, config);
    }

    case 'journal': {
      return syncJournal(ctx, config);
    }

    default:
      return {
        success: false,
        error: `Unknown sync subcommand: ${subCommand}\n` +
          'Available: status, changes, export, import, peers, journal',
      };
  }
}

/**
 * Show synchronization status
 */
async function syncStatus(
  ctx: SyncContext,
  config: CommandConfig
): Promise<CommandResult> {
  if (!ctx.syncManager) {
    return { success: false, error: 'Sync manager not initialized' };
  }

  try {
    const state = await ctx.syncManager.getLocalStateAsync();
    const peers = ctx.syncManager.getPeers();

    if (config.json) {
      return {
        success: true,
        data: {
          nodeId: state.nodeId,
          sequence: state.sequence,
          merkleRoot: state.merkleRoot,
          vectorClock: state.vectorClock.toJSON(),
          lastSync: state.lastSync,
          connectedPeers: peers.length,
        },
      };
    }

    let output = 'Sync Status\n';
    output += '='.repeat(60) + '\n\n';
    output += `  Node ID:      ${state.nodeId}\n`;
    output += `  Sequence:     ${state.sequence}\n`;
    output += `  Merkle Root:  ${state.merkleRoot || '(empty)'}\n`;
    output += `  Last Sync:    ${state.lastSync || 'Never'}\n`;
    output += '\n  Vector Clock:\n';

    const clock = state.vectorClock.toJSON();
    for (const [nodeId, seq] of Object.entries(clock)) {
      output += `    ${nodeId}: ${seq}\n`;
    }

    output += `\n  Connected Peers: ${peers.length}\n`;
    for (const peer of peers) {
      output += `    - ${peer.peerId} (${peer.status})\n`;
    }

    return { success: true, data: output };
  } catch (error) {
    return {
      success: false,
      error: `Failed to get sync status: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * List changes from journal
 */
async function syncChanges(
  ctx: SyncContext,
  config: CommandConfig,
  fromSeq: number,
  limit: number
): Promise<CommandResult> {
  if (!ctx.syncManager) {
    return { success: false, error: 'Sync manager not initialized' };
  }

  try {
    const changes = await ctx.syncManager.getChangesSince(fromSeq);
    const limitedChanges = changes.slice(0, limit);

    if (config.json) {
      return {
        success: true,
        data: {
          total: changes.length,
          shown: limitedChanges.length,
          fromSequence: fromSeq,
          changes: limitedChanges,
        },
      };
    }

    let output = `Changes since sequence ${fromSeq}\n`;
    output += '='.repeat(60) + '\n\n';
    output += `  Total: ${changes.length}, Showing: ${limitedChanges.length}\n\n`;

    if (limitedChanges.length === 0) {
      output += '  No changes found.\n';
    } else {
      for (const change of limitedChanges) {
        output += `  [${change.sequence}] ${change.operation.toUpperCase()} ${change.type}\n`;
        output += `       Entity: ${change.entityId}\n`;
        output += `       Time:   ${change.timestamp}\n`;
        output += '\n';
      }
    }

    return { success: true, data: output };
  } catch (error) {
    return {
      success: false,
      error: `Failed to get changes: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Export sync state to JSON file
 */
async function syncExport(
  ctx: SyncContext,
  config: CommandConfig,
  outputPath: string
): Promise<CommandResult> {
  if (!ctx.syncManager) {
    return { success: false, error: 'Sync manager not initialized' };
  }

  try {
    // Sanitize output path
    const safePath = sanitizePath(outputPath);

    // Ensure file has .json extension
    const finalPath = safePath.toLowerCase().endsWith('.json')
      ? safePath
      : `${safePath}.json`;

    const state = await ctx.syncManager.getLocalStateAsync();
    const changes = await ctx.syncManager.getChangesSince(0);
    const peers = ctx.syncManager.getPeers();

    const exportData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      state: {
        nodeId: state.nodeId,
        sequence: state.sequence,
        merkleRoot: state.merkleRoot,
        vectorClock: state.vectorClock.toJSON(),
        lastSync: state.lastSync,
      },
      changes,
      peers: peers.map((p) => ({
        peerId: p.peerId,
        endpoint: p.endpoint,
        lastSequence: p.lastSequence,
      })),
    };

    await fs.writeFile(finalPath, JSON.stringify(exportData, null, 2));

    if (config.json) {
      return {
        success: true,
        data: {
          exported: true,
          path: finalPath,
          sequence: state.sequence,
          changeCount: changes.length,
        },
      };
    }

    let output = 'Sync State Exported\n';
    output += '='.repeat(60) + '\n\n';
    output += `  File:     ${finalPath}\n`;
    output += `  Sequence: ${state.sequence}\n`;
    output += `  Changes:  ${changes.length}\n`;
    output += `  Peers:    ${peers.length}\n`;

    return { success: true, data: output };
  } catch (error) {
    return {
      success: false,
      error: `Failed to export: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Import sync state from JSON file
 */
async function syncImport(
  ctx: SyncContext,
  _config: CommandConfig,
  filePath: string
): Promise<CommandResult> {
  if (!ctx.syncManager) {
    return { success: false, error: 'Sync manager not initialized' };
  }

  try {
    // Sanitize and validate file path to prevent directory traversal
    const safePath = sanitizePath(filePath);

    // Ensure file has .json extension for safety
    if (!safePath.toLowerCase().endsWith('.json')) {
      return {
        success: false,
        error: 'Import file must have .json extension',
      };
    }

    const content = await fs.readFile(safePath, 'utf-8');
    const importData = JSON.parse(content);

    // Validate import data structure
    if (!importData.version || !importData.state || !importData.changes) {
      return {
        success: false,
        error: 'Invalid import file format. Missing required fields.',
      };
    }

    // Apply imported changes via sync manager
    const applyResult = await ctx.syncManager!.applyRemoteChanges(importData.changes);

    let output = 'Sync State Imported\n';
    output += '='.repeat(60) + '\n\n';
    output += `  File Version: ${importData.version}\n`;
    output += `  Exported At:  ${importData.exportedAt}\n`;
    output += `  Source Node:  ${importData.state.nodeId}\n`;
    output += `  Total Changes: ${importData.changes.length}\n`;
    output += `  Applied:       ${applyResult.applied}\n`;
    output += `  Conflicts:     ${applyResult.conflicts}\n`;

    if (applyResult.resolved && applyResult.resolved.length > 0) {
      output += '\n  Resolved Conflicts:\n';
      for (const r of applyResult.resolved) {
        output += `    - ${r}\n`;
      }
    }

    return { success: true, data: output };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { success: false, error: `File not found: ${filePath}` };
    }
    return {
      success: false,
      error: `Failed to import: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * List connected peers
 */
async function syncPeers(
  ctx: SyncContext,
  config: CommandConfig
): Promise<CommandResult> {
  if (!ctx.syncManager) {
    return { success: false, error: 'Sync manager not initialized' };
  }

  const peers = ctx.syncManager.getPeers();

  if (config.json) {
    return { success: true, data: { peers } };
  }

  let output = 'Connected Peers\n';
  output += '='.repeat(60) + '\n\n';

  if (peers.length === 0) {
    output += '  No peers connected.\n';
  } else {
    for (const peer of peers) {
      output += `  ${peer.peerId}\n`;
      output += `    Endpoint:  ${peer.endpoint}\n`;
      output += `    Status:    ${peer.status}\n`;
      output += `    Last Seen: ${new Date(peer.lastSeen).toISOString()}\n`;
      output += `    Sequence:  ${peer.lastSequence}\n`;
      output += '\n';
    }
  }

  return { success: true, data: output };
}

/**
 * Show journal statistics
 */
async function syncJournal(
  ctx: SyncContext,
  config: CommandConfig
): Promise<CommandResult> {
  if (!ctx.changeJournal) {
    return { success: false, error: 'Change journal not initialized' };
  }

  try {
    const stats = await ctx.changeJournal.getStats();

    if (config.json) {
      return { success: true, data: stats };
    }

    let output = 'Change Journal Statistics\n';
    output += '='.repeat(60) + '\n\n';
    output += `  Total Entries:      ${stats.totalEntries}\n`;
    output += `  Oldest Sequence:    ${stats.oldestSequence}\n`;
    output += `  Latest Sequence:    ${stats.latestSequence}\n`;
    output += `  Entries/min (avg):  ${stats.averageEntriesPerMinute.toFixed(2)}\n`;

    return { success: true, data: output };
  } catch (error) {
    return {
      success: false,
      error: `Failed to get journal stats: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
