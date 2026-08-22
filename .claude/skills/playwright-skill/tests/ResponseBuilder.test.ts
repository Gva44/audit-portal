/**
 * Tests for ResponseBuilder
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ResponseBuilder, createResponseBuilder } from '../src/response/ResponseBuilder.js';
import { CacheStore } from '../src/cache/CacheStore.js';
import type { TabSnapshot, Cookie, ConsoleMessage } from '../src/types.js';

describe('ResponseBuilder', () => {
  let tempDir: string;
  let cache: CacheStore;
  let builder: ResponseBuilder;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'response-builder-test-'));
    cache = new CacheStore({ cacheDir: path.join(tempDir, 'cache') });
    builder = new ResponseBuilder({ cache, sessionName: 'test-session' });
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  const createTestSnapshot = (overrides: Partial<TabSnapshot> = {}): TabSnapshot => ({
    url: 'https://example.com',
    title: 'Example Page',
    ariaSnapshot: '- document\n  - heading "Example"',
    consoleMessages: [],
    modalStates: [],
    ...overrides,
  });

  describe('build', () => {
    it('builds a successful response', async () => {
      const response = await builder.build({
        command: 'navigate https://example.com',
        success: true,
        action: 'Navigated to example.com',
        snapshot: createTestSnapshot(),
      });

      expect(response.success).toBe(true);
      expect(response.command).toBe('navigate https://example.com');
      expect(response.action).toBe('Navigated to example.com');
    });

    it('generates unique request ID', async () => {
      const r1 = await builder.build({
        command: 'cmd1',
        success: true,
        action: 'Action 1',
        snapshot: createTestSnapshot(),
      });

      const r2 = await builder.build({
        command: 'cmd2',
        success: true,
        action: 'Action 2',
        snapshot: createTestSnapshot(),
      });

      expect(r1.id).not.toBe(r2.id);
    });

    it('includes page state', async () => {
      const response = await builder.build({
        command: 'navigate',
        success: true,
        action: 'Navigated',
        snapshot: createTestSnapshot({ url: 'https://example.com/page', title: 'Page Title' }),
      });

      expect(response.pageState.url).toBe('https://example.com/page');
      expect(response.pageState.title).toBe('Page Title');
    });

    it('includes cache reference', async () => {
      const response = await builder.build({
        command: 'navigate',
        success: true,
        action: 'Navigated',
        snapshot: createTestSnapshot(),
      });

      expect(response.cacheRef).toBeDefined();
      expect(response.cacheRef.id).toMatch(/^cache-/);
      expect(response.cacheRef.available).toContain('snapshot');
    });

    it('stores full context in cache', async () => {
      const snapshot = createTestSnapshot({ ariaSnapshot: 'custom snapshot content' });
      const response = await builder.build({
        command: 'navigate',
        success: true,
        action: 'Navigated',
        snapshot,
        html: '<html>test</html>',
      });

      const cached = await cache.get(response.cacheRef.id);
      expect(cached).not.toBeNull();
      expect(cached!.context.snapshot).toBe('custom snapshot content');
      expect(cached!.context.html).toBe('<html>test</html>');
    });

    it('includes optional result', async () => {
      const response = await builder.build({
        command: 'click',
        success: true,
        action: 'Clicked button',
        result: { clicked: true },
        snapshot: createTestSnapshot(),
      });

      expect(response.result).toEqual({ clicked: true });
    });

    it('includes suggestions', async () => {
      const response = await builder.build({
        command: 'click',
        success: true,
        action: 'Clicked',
        suggestions: ['Try filling the form next', 'Check the result'],
        snapshot: createTestSnapshot(),
      });

      expect(response.suggestions).toHaveLength(2);
    });
  });

  describe('success', () => {
    it('builds a success response', async () => {
      const response = await builder.success('navigate', 'Navigated to page', {
        snapshot: createTestSnapshot(),
      });

      expect(response.success).toBe(true);
      expect(response.command).toBe('navigate');
      expect(response.action).toBe('Navigated to page');
    });
  });

  describe('error', () => {
    it('builds an error response', async () => {
      const response = await builder.error('click', new Error('Element not found'));

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
      expect(response.error!.message).toBe('Element not found');
    });

    it('accepts string error', async () => {
      const response = await builder.error('click', 'Something went wrong');

      expect(response.error!.message).toBe('Something went wrong');
    });

    it('includes error suggestion', async () => {
      const response = await builder.error('click', 'Element not found');

      expect(response.suggestions).toBeDefined();
      expect(response.suggestions!.length).toBeGreaterThan(0);
    });
  });

  describe('detectAuthStatus', () => {
    it('detects authenticated from session cookie', () => {
      const cookies: Cookie[] = [
        { name: 'session_id', value: 'abc123', domain: 'example.com', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' },
      ];

      const status = builder.detectAuthStatus('https://example.com/dashboard', cookies);
      expect(status).toBe('authenticated');
    });

    it('detects unauthenticated on login page', () => {
      const cookies: Cookie[] = [];

      const status = builder.detectAuthStatus('https://example.com/login', cookies);
      expect(status).toBe('unauthenticated');
    });

    it('detects unauthenticated on logout redirect', () => {
      const cookies: Cookie[] = [
        { name: 'session_id', value: 'abc123', domain: 'example.com', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' },
      ];

      const status = builder.detectAuthStatus('https://example.com/logged-out', cookies);
      expect(status).toBe('unauthenticated');
    });

    it('detects authenticated from HTML content', () => {
      const cookies: Cookie[] = [];
      const html = '<html><body><a href="/logout">Logout</a></body></html>';

      const status = builder.detectAuthStatus('https://example.com/page', cookies, html);
      expect(status).toBe('authenticated');
    });

    it('detects unauthenticated from HTML content', () => {
      const cookies: Cookie[] = [];
      const html = '<html><body><form>Please login to continue</form></body></html>';

      const status = builder.detectAuthStatus('https://example.com/page', cookies, html);
      expect(status).toBe('unauthenticated');
    });

    it('returns unknown when cannot determine', () => {
      const cookies: Cookie[] = [
        { name: 'tracking', value: 'xyz', domain: 'example.com', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' },
      ];

      const status = builder.detectAuthStatus('https://example.com/public', cookies);
      expect(status).toBe('unknown');
    });
  });

  describe('formatError', () => {
    it('formats Error object', () => {
      const error = new Error('Something failed');
      const formatted = builder.formatError(error);

      expect(formatted.message).toBe('Something failed');
    });

    it('formats string error', () => {
      const formatted = builder.formatError('Something failed');

      expect(formatted.message).toBe('Something failed');
    });

    it('suggests for timeout errors', () => {
      const formatted = builder.formatError('Timeout exceeded');

      expect(formatted.suggestion).toBeDefined();
      expect(formatted.suggestion).toContain('timeout');
    });

    it('suggests for element not found', () => {
      const formatted = builder.formatError('Element not found');

      expect(formatted.suggestion).toBeDefined();
      expect(formatted.suggestion).toContain('snapshot');
    });

    it('suggests for dialog errors', () => {
      const formatted = builder.formatError('Cannot click: dialog is blocking');

      expect(formatted.suggestion).toBeDefined();
      expect(formatted.suggestion).toContain('dialog');
    });
  });

  describe('buildPageState', () => {
    it('builds page state from parameters', () => {
      const cookies: Cookie[] = [
        { name: 'auth_token', value: 'xyz', domain: 'example.com', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' },
      ];

      const state = builder.buildPageState(
        'https://example.com/dashboard',
        'Dashboard',
        cookies
      );

      expect(state.url).toBe('https://example.com/dashboard');
      expect(state.title).toBe('Dashboard');
      expect(state.authStatus).toBe('authenticated');
      expect(state.hasErrors).toBe(false);
    });

    it('detects console errors', () => {
      const consoleMessages: ConsoleMessage[] = [
        { type: 'error', text: 'Failed to load resource', timestamp: new Date().toISOString() },
      ];

      const state = builder.buildPageState(
        'https://example.com',
        'Page',
        [],
        undefined,
        consoleMessages
      );

      expect(state.hasErrors).toBe(true);
    });
  });

  describe('getCache', () => {
    it('returns the cache store', () => {
      expect(builder.getCache()).toBe(cache);
    });
  });

  describe('getSessionName', () => {
    it('returns the session name', () => {
      expect(builder.getSessionName()).toBe('test-session');
    });
  });

  describe('createResponseBuilder', () => {
    it('creates a builder instance', () => {
      const builder = createResponseBuilder(cache, 'my-session');
      expect(builder).toBeInstanceOf(ResponseBuilder);
      expect(builder.getSessionName()).toBe('my-session');
    });
  });
});
