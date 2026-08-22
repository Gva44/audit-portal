/**
 * Tests for Logger
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger, getLogger, initLogger } from '../src/logging/Logger.js';

describe('Logger', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  describe('log levels', () => {
    it('logs error messages at info level', () => {
      const logger = new Logger({ level: 'info', useColors: false });
      logger.error('test error');

      expect(stderrSpy).toHaveBeenCalledTimes(1);
      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain('ERROR');
      expect(output).toContain('test error');
    });

    it('logs warn messages at info level', () => {
      const logger = new Logger({ level: 'info', useColors: false });
      logger.warn('test warning');

      expect(stderrSpy).toHaveBeenCalledTimes(1);
      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain('WARN');
      expect(output).toContain('test warning');
    });

    it('logs info messages at info level', () => {
      const logger = new Logger({ level: 'info', useColors: false });
      logger.info('test info');

      expect(stderrSpy).toHaveBeenCalledTimes(1);
      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain('INFO');
      expect(output).toContain('test info');
    });

    it('does not log debug messages at info level', () => {
      const logger = new Logger({ level: 'info', useColors: false });
      logger.debug('test debug');

      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('logs debug messages at debug level', () => {
      const logger = new Logger({ level: 'debug', useColors: false });
      logger.debug('test debug');

      expect(stderrSpy).toHaveBeenCalledTimes(1);
      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain('DEBUG');
      expect(output).toContain('test debug');
    });

    it('enables debug level when debug option is true', () => {
      const logger = new Logger({ debug: true, useColors: false });
      logger.debug('test debug');

      expect(stderrSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('timestamps', () => {
    it('includes ISO timestamp in log output', () => {
      const logger = new Logger({ level: 'info', useColors: false });
      logger.info('test');

      const output = stderrSpy.mock.calls[0][0] as string;
      // ISO timestamp format: 2025-12-20T00:00:00.000Z
      expect(output).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/);
    });
  });

  describe('prefix', () => {
    it('uses default prefix', () => {
      const logger = new Logger({ level: 'info', useColors: false });
      logger.info('test');

      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain('[playwright-skill]');
    });

    it('uses custom prefix', () => {
      const logger = new Logger({ level: 'info', prefix: 'custom', useColors: false });
      logger.info('test');

      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain('[custom]');
    });
  });

  describe('data logging', () => {
    it('logs object data as JSON', () => {
      const logger = new Logger({ level: 'info', useColors: false });
      logger.info('test', { key: 'value' });

      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain('{"key":"value"}');
    });

    it('logs Error objects with message and stack', () => {
      const logger = new Logger({ level: 'error', useColors: false });
      const error = new Error('test error');
      logger.error('caught error', error);

      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain('test error');
      expect(output).toContain('at '); // Stack trace
    });

    it('logs primitive data', () => {
      const logger = new Logger({ level: 'info', useColors: false });
      logger.info('count', 42);

      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain('42');
    });
  });

  describe('child logger', () => {
    it('creates child logger with combined prefix', () => {
      const logger = new Logger({ level: 'info', prefix: 'parent', useColors: false });
      const child = logger.child('child');
      child.info('test');

      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain('[parent:child]');
    });

    it('inherits log level from parent', () => {
      const logger = new Logger({ level: 'warn', useColors: false });
      const child = logger.child('child');
      child.info('test');

      expect(stderrSpy).not.toHaveBeenCalled();
    });
  });

  describe('setLevel', () => {
    it('changes log level dynamically', () => {
      const logger = new Logger({ level: 'info', useColors: false });

      logger.debug('should not log');
      expect(stderrSpy).not.toHaveBeenCalled();

      logger.setLevel('debug');
      logger.debug('should log');
      expect(stderrSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('isLevelEnabled', () => {
    it('returns true for enabled levels', () => {
      const logger = new Logger({ level: 'info' });
      expect(logger.isLevelEnabled('error')).toBe(true);
      expect(logger.isLevelEnabled('warn')).toBe(true);
      expect(logger.isLevelEnabled('info')).toBe(true);
      expect(logger.isLevelEnabled('debug')).toBe(false);
    });
  });

  describe('getLogger and initLogger', () => {
    it('returns a logger instance', () => {
      const logger = getLogger({ useColors: false });
      expect(logger).toBeInstanceOf(Logger);
    });

    it('initLogger creates new logger', () => {
      const logger1 = initLogger({ level: 'debug', useColors: false });
      const logger2 = getLogger();

      expect(logger1).toBe(logger2);
    });
  });
});
