/**
 * Observability Logger for Playwright Skill
 *
 * Logs cache access patterns for optimization analysis.
 * Writes JSONL format for easy processing.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { CacheDataType, CacheAccessLog } from '../types.js';

export interface ObservabilityLoggerOptions {
  sessionDir: string;
  sessionName: string;
}

export class ObservabilityLogger {
  private logPath: string;
  private initialized: boolean = false;

  constructor(options: ObservabilityLoggerOptions) {
    this.logPath = path.join(
      options.sessionDir,
      options.sessionName,
      'logs',
      'cache-access.jsonl'
    );
  }

  /**
   * Ensure the log directory exists
   */
  private async ensureDir(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const dir = path.dirname(this.logPath);
    await fs.promises.mkdir(dir, { recursive: true });
    this.initialized = true;
  }

  /**
   * Log a cache access event
   */
  async logCacheAccess(
    requestId: string,
    cacheId: string,
    dataType: CacheDataType,
    hitOrMiss: 'hit' | 'miss',
    reason?: string
  ): Promise<void> {
    await this.ensureDir();

    const entry: CacheAccessLog = {
      timestamp: new Date().toISOString(),
      requestId,
      cacheId,
      dataType,
      hitOrMiss,
      ...(reason && { reason }),
    };

    const line = JSON.stringify(entry) + '\n';

    await fs.promises.appendFile(this.logPath, line, 'utf-8');
  }

  /**
   * Log a cache hit (agent found what it needed in trimmed response)
   */
  async logCacheHit(
    requestId: string,
    cacheId: string,
    dataType: CacheDataType
  ): Promise<void> {
    await this.logCacheAccess(requestId, cacheId, dataType, 'hit');
  }

  /**
   * Log a cache dive (agent needed to query full context from cache)
   * The reason helps us understand why trimmed response was insufficient
   */
  async logCacheDive(
    requestId: string,
    cacheId: string,
    dataType: CacheDataType,
    reason?: string
  ): Promise<void> {
    await this.logCacheAccess(requestId, cacheId, dataType, 'miss', reason);
  }

  /**
   * Read all cache access logs for analysis
   */
  async readLogs(): Promise<CacheAccessLog[]> {
    try {
      const content = await fs.promises.readFile(this.logPath, 'utf-8');
      return content
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as CacheAccessLog);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Get cache dive statistics for optimization
   */
  async getStats(): Promise<{
    totalAccesses: number;
    hits: number;
    misses: number;
    hitRate: number;
    byDataType: Record<string, { hits: number; misses: number }>;
    byCommand: Record<string, { hits: number; misses: number }>;
  }> {
    const logs = await this.readLogs();

    const stats = {
      totalAccesses: logs.length,
      hits: 0,
      misses: 0,
      hitRate: 0,
      byDataType: {} as Record<string, { hits: number; misses: number }>,
      byCommand: {} as Record<string, { hits: number; misses: number }>,
    };

    for (const log of logs) {
      if (log.hitOrMiss === 'hit') {
        stats.hits++;
      } else {
        stats.misses++;
      }

      // By data type
      if (!stats.byDataType[log.dataType]) {
        stats.byDataType[log.dataType] = { hits: 0, misses: 0 };
      }
      stats.byDataType[log.dataType][log.hitOrMiss === 'hit' ? 'hits' : 'misses']++;
    }

    if (stats.totalAccesses > 0) {
      stats.hitRate = stats.hits / stats.totalAccesses;
    }

    return stats;
  }

  /**
   * Clear the log file
   */
  async clear(): Promise<void> {
    try {
      await fs.promises.unlink(this.logPath);
      this.initialized = false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Get the path to the log file
   */
  getLogPath(): string {
    return this.logPath;
  }
}

// Factory function for creating observability loggers
export function createObservabilityLogger(
  sessionDir: string,
  sessionName: string
): ObservabilityLogger {
  return new ObservabilityLogger({ sessionDir, sessionName });
}
