/**
 * Logger for Playwright Skill
 *
 * Outputs to stderr to keep stdout clean for JSON responses.
 * Supports debug, info, warn, error levels with ISO timestamps.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LOG_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[36m', // cyan
  info: '\x1b[32m',  // green
  warn: '\x1b[33m',  // yellow
  error: '\x1b[31m', // red
};

const RESET = '\x1b[0m';

export interface LoggerOptions {
  level?: LogLevel;
  debug?: boolean;
  prefix?: string;
  useColors?: boolean;
}

export class Logger {
  private level: LogLevel;
  private prefix: string;
  private useColors: boolean;

  constructor(options: LoggerOptions = {}) {
    // If debug is true, set level to debug; otherwise use provided level or default to info
    this.level = options.debug ? 'debug' : (options.level ?? 'info');
    this.prefix = options.prefix ?? 'playwright-skill';
    this.useColors = options.useColors ?? process.stderr.isTTY ?? false;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  private formatMessage(level: LogLevel, message: string, data?: unknown): string {
    const timestamp = new Date().toISOString();
    const levelStr = level.toUpperCase().padEnd(5);

    let formatted = `[${timestamp}] ${levelStr} [${this.prefix}] ${message}`;

    if (data !== undefined) {
      if (data instanceof Error) {
        formatted += `\n  ${data.message}`;
        if (data.stack) {
          formatted += `\n${data.stack.split('\n').slice(1).map(l => '  ' + l).join('\n')}`;
        }
      } else if (typeof data === 'object') {
        formatted += ` ${JSON.stringify(data)}`;
      } else {
        formatted += ` ${String(data)}`;
      }
    }

    if (this.useColors) {
      const color = LOG_COLORS[level];
      formatted = `${color}${formatted}${RESET}`;
    }

    return formatted;
  }

  private log(level: LogLevel, message: string, data?: unknown): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const formatted = this.formatMessage(level, message, data);
    // Always write to stderr to keep stdout clean for JSON responses
    process.stderr.write(formatted + '\n');
  }

  debug(message: string, data?: unknown): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: unknown): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: unknown): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: unknown): void {
    this.log('error', message, data);
  }

  /**
   * Create a child logger with a different prefix
   */
  child(prefix: string): Logger {
    return new Logger({
      level: this.level,
      prefix: `${this.prefix}:${prefix}`,
      useColors: this.useColors,
    });
  }

  /**
   * Set the log level dynamically
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * Check if a specific log level is enabled
   */
  isLevelEnabled(level: LogLevel): boolean {
    return this.shouldLog(level);
  }
}

// Default logger instance
let defaultLogger: Logger | null = null;

/**
 * Get or create the default logger instance
 */
export function getLogger(options?: LoggerOptions): Logger {
  if (!defaultLogger || options) {
    defaultLogger = new Logger(options);
  }
  return defaultLogger;
}

/**
 * Initialize the default logger with options
 */
export function initLogger(options: LoggerOptions): Logger {
  defaultLogger = new Logger(options);
  return defaultLogger;
}
