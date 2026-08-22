/**
 * Tests for CacheStore
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CacheStore, createCacheStore } from '../src/cache/CacheStore.js';
import type { FullContext } from '../src/types.js';

describe('CacheStore', () => {
  let tempDir: string;
  let cacheDir: string;
  let store: CacheStore;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cache-store-test-'));
    cacheDir = path.join(tempDir, 'cache');
    store = new CacheStore({ cacheDir, maxEntries: 5 });
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  const createTestContext = (overrides: Partial<FullContext> = {}): FullContext => ({
    snapshot: '- document\n  - heading "Test Page"',
    html: '<html><body><h1>Test Page</h1></body></html>',
    console: [{ type: 'log', text: 'Hello', timestamp: new Date().toISOString() }],
    network: [{ url: 'https://example.com', method: 'GET', resourceType: 'document', timestamp: new Date().toISOString() }],
    cookies: [],
    timing: {
      commandStart: Date.now(),
      commandEnd: Date.now() + 100,
      snapshotTime: Date.now() + 50,
    },
    ...overrides,
  });

  describe('store', () => {
    it('stores a context entry', async () => {
      const context = createTestContext();
      const id = await store.store('navigate https://example.com', context);

      expect(id).toBeDefined();
      expect(id).toMatch(/^cache-/);
    });

    it('creates cache directory', async () => {
      const context = createTestContext();
      await store.store('navigate', context);

      const stats = await fs.promises.stat(cacheDir);
      expect(stats.isDirectory()).toBe(true);
    });

    it('writes entry to disk', async () => {
      const context = createTestContext();
      const id = await store.store('navigate', context);

      const entryPath = path.join(cacheDir, `${id}.json`);
      const exists = fs.existsSync(entryPath);
      expect(exists).toBe(true);
    });

    it('updates index', async () => {
      const context = createTestContext();
      await store.store('navigate', context);

      const entries = await store.list();
      expect(entries).toHaveLength(1);
    });
  });

  describe('get', () => {
    it('retrieves stored entry', async () => {
      const context = createTestContext();
      const id = await store.store('navigate https://example.com', context);

      const entry = await store.get(id);

      expect(entry).not.toBeNull();
      expect(entry!.id).toBe(id);
      expect(entry!.command).toBe('navigate https://example.com');
      expect(entry!.context.html).toBe(context.html);
    });

    it('returns null for non-existent entry', async () => {
      const entry = await store.get('cache-nonexistent');
      expect(entry).toBeNull();
    });
  });

  describe('query', () => {
    it('queries snapshot data', async () => {
      const context = createTestContext({ snapshot: '- document with content' });
      const id = await store.store('snapshot', context);

      const result = await store.query(id, 'snapshot');
      expect(result).toBe('- document with content');
    });

    it('queries html data', async () => {
      const context = createTestContext({ html: '<html>test</html>' });
      const id = await store.store('getHtml', context);

      const result = await store.query(id, 'html');
      expect(result).toBe('<html>test</html>');
    });

    it('queries screenshot data', async () => {
      const context = createTestContext({ screenshot: 'base64-image-data' });
      const id = await store.store('screenshot', context);

      const result = await store.query(id, 'screenshot');
      expect(result).toBe('base64-image-data');
    });

    it('returns null for missing screenshot', async () => {
      const context = createTestContext();
      delete (context as any).screenshot;
      const id = await store.store('noScreenshot', context);

      const result = await store.query(id, 'screenshot');
      expect(result).toBeNull();
    });

    it('queries console data as JSON', async () => {
      const context = createTestContext({
        console: [{ type: 'log', text: 'Test log', timestamp: '2024-01-01T00:00:00.000Z' }],
      });
      const id = await store.store('getConsole', context);

      const result = await store.query(id, 'console');
      expect(result).toContain('Test log');

      const parsed = JSON.parse(result!);
      expect(parsed).toHaveLength(1);
    });

    it('queries network data as JSON', async () => {
      const context = createTestContext({
        network: [{ url: 'https://api.example.com', method: 'POST', resourceType: 'xhr', timestamp: '2024-01-01T00:00:00.000Z' }],
      });
      const id = await store.store('getNetwork', context);

      const result = await store.query(id, 'network');
      expect(result).toContain('api.example.com');

      const parsed = JSON.parse(result!);
      expect(parsed).toHaveLength(1);
    });

    it('returns null for non-existent entry', async () => {
      const result = await store.query('cache-nonexistent', 'html');
      expect(result).toBeNull();
    });
  });

  describe('list', () => {
    it('returns empty array when no entries', async () => {
      const entries = await store.list();
      expect(entries).toEqual([]);
    });

    it('returns all entries', async () => {
      const context = createTestContext();
      await store.store('cmd1', context);
      await store.store('cmd2', context);
      await store.store('cmd3', context);

      const entries = await store.list();
      expect(entries).toHaveLength(3);
    });

    it('includes entry metadata', async () => {
      const context = createTestContext();
      const id = await store.store('navigate https://example.com', context);

      const entries = await store.list();
      expect(entries[0].id).toBe(id);
      expect(entries[0].command).toBe('navigate https://example.com');
      expect(entries[0].timestamp).toBeDefined();
      expect(entries[0].size).toBeGreaterThan(0);
    });
  });

  describe('LRU eviction', () => {
    it('evicts oldest entries when limit exceeded', async () => {
      const context = createTestContext();

      // Store 7 entries with max 5
      const ids: string[] = [];
      for (let i = 0; i < 7; i++) {
        ids.push(await store.store(`command-${i}`, context));
      }

      const entries = await store.list();
      expect(entries).toHaveLength(5);

      // First 2 should be evicted
      const entry0 = await store.get(ids[0]);
      const entry1 = await store.get(ids[1]);
      expect(entry0).toBeNull();
      expect(entry1).toBeNull();

      // Last 5 should still exist
      const entry2 = await store.get(ids[2]);
      expect(entry2).not.toBeNull();
    });

    it('updates lastEviction timestamp', async () => {
      const context = createTestContext();

      for (let i = 0; i < 7; i++) {
        await store.store(`command-${i}`, context);
      }

      const stats = await store.getStats();
      expect(stats.lastEviction).toBeDefined();
    });
  });

  describe('getStats', () => {
    it('returns cache statistics', async () => {
      const context = createTestContext();
      await store.store('cmd1', context);
      await store.store('cmd2', context);

      const stats = await store.getStats();

      expect(stats.entryCount).toBe(2);
      expect(stats.totalSize).toBeGreaterThan(0);
      expect(stats.maxEntries).toBe(5);
    });

    it('returns zeros for empty cache', async () => {
      const stats = await store.getStats();

      expect(stats.entryCount).toBe(0);
      expect(stats.totalSize).toBe(0);
    });
  });

  describe('delete', () => {
    it('deletes a specific entry', async () => {
      const context = createTestContext();
      const id = await store.store('delete-me', context);

      const deleted = await store.delete(id);
      expect(deleted).toBe(true);

      const entry = await store.get(id);
      expect(entry).toBeNull();
    });

    it('updates index after delete', async () => {
      const context = createTestContext();
      await store.store('cmd1', context);
      const id2 = await store.store('cmd2', context);
      await store.store('cmd3', context);

      await store.delete(id2);

      const entries = await store.list();
      expect(entries).toHaveLength(2);
      expect(entries.find(e => e.id === id2)).toBeUndefined();
    });

    it('returns false for non-existent entry', async () => {
      const deleted = await store.delete('cache-nonexistent');
      expect(deleted).toBe(false);
    });
  });

  describe('clear', () => {
    it('removes all entries', async () => {
      const context = createTestContext();
      await store.store('cmd1', context);
      await store.store('cmd2', context);
      await store.store('cmd3', context);

      await store.clear();

      const entries = await store.list();
      expect(entries).toHaveLength(0);
    });

    it('resets total size', async () => {
      const context = createTestContext();
      await store.store('cmd1', context);

      await store.clear();

      const stats = await store.getStats();
      expect(stats.totalSize).toBe(0);
    });
  });

  describe('search', () => {
    it('finds entries by command pattern', async () => {
      const context = createTestContext();
      await store.store('navigate https://example.com', context);
      await store.store('click button', context);
      await store.store('navigate https://test.com', context);

      const results = await store.search('navigate');
      expect(results).toHaveLength(2);
    });

    it('is case insensitive', async () => {
      const context = createTestContext();
      await store.store('NAVIGATE https://example.com', context);

      const results = await store.search('navigate');
      expect(results).toHaveLength(1);
    });

    it('returns empty array when no matches', async () => {
      const context = createTestContext();
      await store.store('navigate', context);

      const results = await store.search('nonexistent');
      expect(results).toHaveLength(0);
    });
  });

  describe('getLatest', () => {
    it('returns most recent entry', async () => {
      const context = createTestContext();
      await store.store('first', context);
      await store.store('second', context);
      const lastId = await store.store('last', context);

      const latest = await store.getLatest();
      expect(latest).not.toBeNull();
      expect(latest!.id).toBe(lastId);
      expect(latest!.command).toBe('last');
    });

    it('returns null when empty', async () => {
      const latest = await store.getLatest();
      expect(latest).toBeNull();
    });
  });

  describe('getCacheDir', () => {
    it('returns cache directory path', () => {
      expect(store.getCacheDir()).toBe(cacheDir);
    });
  });

  describe('createCacheStore', () => {
    it('creates a store instance', () => {
      const store = createCacheStore(cacheDir);
      expect(store).toBeInstanceOf(CacheStore);
    });

    it('accepts custom max entries', () => {
      const store = createCacheStore(cacheDir, 10);
      expect(store).toBeInstanceOf(CacheStore);
    });
  });
});
