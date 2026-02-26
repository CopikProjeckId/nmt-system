/**
 * Structured Logger for NMT System
 *
 * Provides consistent logging across all modules with:
 * - Log levels (DEBUG, INFO, WARN, ERROR)
 * - Structured JSON output option
 * - Module context tracking
 * - Performance timing helpers
 *
 * @module utils/logger
 */

/**
 * Log levels in order of severity
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4,
}

/**
 * Log entry structure
 */
export interface LogEntry {
  timestamp: string;
  level: keyof typeof LogLevel;
  module: string;
  message: string;
  data?: Record<string, unknown>;
  duration?: number;
}

/**
 * Logger configuration
 */
export interface LoggerConfig {
  level: LogLevel;
  json: boolean;
  includeTimestamp: boolean;
  module?: string;
}

const DEFAULT_CONFIG: LoggerConfig = {
  level: LogLevel.INFO,
  json: false,
  includeTimestamp: true,
};

let globalConfig: LoggerConfig = { ...DEFAULT_CONFIG };

/**
 * Format a log entry for console output
 */
function formatEntry(entry: LogEntry, config: LoggerConfig): string {
  if (config.json) {
    return JSON.stringify(entry);
  }

  const parts: string[] = [];

  if (config.includeTimestamp) {
    parts.push(`[${entry.timestamp}]`);
  }

  parts.push(`[${entry.level}]`);
  parts.push(`[${entry.module}]`);
  parts.push(entry.message);

  if (entry.duration !== undefined) {
    parts.push(`(${entry.duration}ms)`);
  }

  if (entry.data && Object.keys(entry.data).length > 0) {
    parts.push(JSON.stringify(entry.data));
  }

  return parts.join(' ');
}

/**
 * Logger class for module-specific logging
 */
export class Logger {
  private module: string;
  private config: LoggerConfig;

  constructor(module: string, config?: Partial<LoggerConfig>) {
    this.module = module;
    this.config = { ...globalConfig, ...config, module };
  }

  private log(level: LogLevel, levelName: keyof typeof LogLevel, message: string, data?: Record<string, unknown>): void {
    if (level < this.config.level) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: levelName,
      module: this.module,
      message,
      data,
    };

    const formatted = formatEntry(entry, this.config);

    switch (level) {
      case LogLevel.ERROR:
        console.error(formatted);
        break;
      case LogLevel.WARN:
        console.warn(formatted);
        break;
      case LogLevel.DEBUG:
        console.debug(formatted);
        break;
      default:
        console.log(formatted);
    }
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, 'DEBUG', message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, 'INFO', message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, 'WARN', message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, 'ERROR', message, data);
  }

  /**
   * Create a timer for performance measurement
   */
  time(label: string): () => void {
    const start = performance.now();
    return () => {
      const duration = Math.round(performance.now() - start);
      this.info(`${label} completed`, { duration });
    };
  }

  /**
   * Wrap an async function with timing
   */
  async timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const end = this.time(label);
    try {
      return await fn();
    } finally {
      end();
    }
  }

  /**
   * Create a child logger with additional context
   */
  child(subModule: string): Logger {
    return new Logger(`${this.module}:${subModule}`, this.config);
  }
}

/**
 * Configure global logger settings
 */
export function configureLogger(config: Partial<LoggerConfig>): void {
  globalConfig = { ...globalConfig, ...config };
}

/**
 * Create a logger for a specific module
 */
export function createLogger(module: string, config?: Partial<LoggerConfig>): Logger {
  return new Logger(module, config);
}

/**
 * Set global log level
 */
export function setLogLevel(level: LogLevel): void {
  globalConfig.level = level;
}

/**
 * Enable JSON output mode
 */
export function setJsonOutput(enabled: boolean): void {
  globalConfig.json = enabled;
}

// Pre-configured loggers for common modules
export const coreLogger = createLogger('core');
export const storageLogger = createLogger('storage');
export const servicesLogger = createLogger('services');
export const cliLogger = createLogger('cli');
export const apiLogger = createLogger('api');
