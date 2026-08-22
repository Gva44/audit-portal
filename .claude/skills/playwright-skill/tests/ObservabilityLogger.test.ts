/**
 * Tests for ObservabilityLogger
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ObservabilityLogger, createObservabilityLogger } from '../src/logging/ObservabilityLogger.js';

describe('ObservabilityLogger', () => {
  let tempDir: string;
  let logger: ObservabilityLogger;

  beforeEach(async () => {
    // Create a temporary directory for each test
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'obs-logger-test-'));
    logger = new ObservabilityLogger({
      sessionDir: tempDir,
      sessionName: 'test-session',
    });
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  describe('logCacheAccess', () => {
    it('creates log directory if not exists', async () => {
      await logger.logCacheAccess('req-1', 'cache-1', 'snapshot', 'hit');

      const logDir = path.join(tempDir, 'test-session', 'logs');
      const stats = await fs.promises.stat(logDir);
      expect(stats.isDirectory()).toBe(true);
    });

    it('writes JSONL format', async () => {
      await logger.logCacheAccess('req-1', 'cache-1', 'snapshot', 'hit');

      const content = await fs.promises.readFile(logger.getLogPath(), 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(1);

      const entry = JSON.parse(lines[0]);
      expect(entry.requestId).toBe('req-1');
      expect(entry.cacheId).toBe('cache-1');
      expect(entry.dataType).toBe('snapshot');
      expect(entry.hitOrMiss).toBe('hit');
    });

    it('includes ISO timestamp', async () => {
      await logger.logCacheAccess('req-1', 'cache-1', 'html', 'miss');

      const logs = await logger.readLogs();
      expect(logs[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('includes optional reason', async () => {
      await logger.logCacheAccess(
        'req-1',
        'cache-1',
        'snapshot',
        'miss',
        'Need full element tree for form filling'
      );

      const logs = await logger.readLogs();
      expect(logs[0].reason).toBe('Need full element tree for form filling');
    });

    it('appends to existing file', async () => {
      await logger.logCacheAccess('req-1', 'cache-1', 'snapshot', 'hit');
      await logger.logCacheAccess('req-2', 'cache-2', 'html', 'miss');
      await logger.logCacheAccess('req-3', 'cache-3', 'screenshot', 'hit');

      const logs = await logger.readLogs();
      expect(logs).toHaveLength(3);
      expect(logs[0].requestId).toBe('req-1');
      expect(logs[1].requestId).toBe('req-2');
      expect(logs[2].requestId).toBe('req-3');
    });
  });

  describe('logCacheHit', () => {
    it('logs a cache hit', async () => {
      await logger.logCacheHit('req-1', 'cache-1', 'snapshot');

      const logs = await logger.readLogs();
      expect(logs[0].hitOrMiss).toBe('hit');
    });
  });

  describe('logCacheDive', () => {
    it('logs a cache dive (miss)', async () => {
      await logger.logCacheDive('req-1', 'cache-1', 'snapshot');

      const logs = await logger.readLogs();
      expect(logs[0].hitOrMiss).toBe('miss');
    });

    it('logs cache dive with reason', async () => {
      await logger.logCacheDive('req-1', 'cache-1', 'html', 'Need to analyze form structure');

      const logs = await logger.readLogs();
      expect(logs[0].reason).toBe('Need to analyze form structure');
    });
  });

  describe('readLogs', () => {
    it('returns empty array when file does not exist', async () => {
      const logs = await logger.readLogs();
      expect(logs).toEqual([]);
    });

    it('parses all log entries', async () => {
      await logger.logCacheAccess('req-1', 'cache-1', 'snapshot', 'hit');
      await logger.logCacheAccess('req-2', 'cache-2', 'html', 'miss');

      const logs = await logger.readLogs();
      expect(logs).toHaveLength(2);
      expect(logs[0].dataType).toBe('snapshot');
      expect(logs[1].dataType).toBe('html');
    });
  });

  describe('getStats', () => {
    it('returns zero stats for empty logs', async () => {
      const stats = await logger.getStats();

      expect(stats.totalAccesses).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
    });

    it('calculates correct hit rate', async () => {
      await logger.logCacheHit('req-1', 'cache-1', 'snapshot');
      await logger.logCacheHit('req-2', 'cache-2', 'snapshot');
      await logger.logCacheDive('req-3', 'cache-3', 'html');
      await logger.logCacheHit('req-4', 'cache-4', 'snapshot');

      const stats = await logger.getStats();

      expect(stats.totalAccesses).toBe(4);
      expect(stats.hits).toBe(3);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(0.75);
    });

    it('breaks down by data type', async () => {
      await logger.logCacheHit('req-1', 'cache-1', 'snapshot');
      await logger.logCacheDive('req-2', 'cache-2', 'snapshot');
      await logger.logCacheHit('req-3', 'cache-3', 'html');
      await logger.logCacheDive('req-4', 'cache-4', 'screenshot');

      const stats = await logger.getStats();

      expect(stats.byDataType.snapshot).toEqual({ hits: 1, misses: 1 });
      expect(stats.byDataType.html).toEqual({ hits: 1, misses: 0 });
      expect(stats.byDataType.screenshot).toEqual({ hits: 0, misses: 1 });
    });
  });

  describe('clear', () => {
    it('removes the log file', async () => {
      await logger.logCacheAccess('req-1', 'cache-1', 'snapshot', 'hit');

      const pathBefore = logger.getLogPath();
      expect(fs.existsSync(pathBefore)).toBe(true);

      await logger.clear();

      expect(fs.existsSync(pathBefore)).toBe(false);
    });

    it('does not throw if file does not exist', async () => {
      await expect(logger.clear()).resolves.not.toThrow();
    });
  });

  describe('getLogPath', () => {
    it('returns correct path', () => {
      const expected = path.join(tempDir, 'test-session', 'logs', 'cache-access.jsonl');
      expect(logger.getLogPath()).toBe(expected);
    });
  });

  describe('createObservabilityLogger', () => {
    it('creates a logger instance', () => {
      const logger = createObservabilityLogger(tempDir, 'my-session');
      expect(logger).toBeInstanceOf(ObservabilityLogger);
      expect(logger.getLogPath()).toContain('my-session');
    });
  });
});
