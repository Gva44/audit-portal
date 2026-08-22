/**
 * Cache Store
 *
 * Manages full context cache with LRU eviction.
 * Stores snapshots, HTML, screenshots, console logs, and network activity.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { FullContext, CacheEntry, CacheIndex, CacheIndexEntry, CacheDataType } from '../types.js';
import { FullContextSchema, CacheIndexSchema } from '../types.js';
import { getLogger } from '../logging/index.js';

const logger = getLogger().child('CacheStore');

export interface CacheStoreOptions {
  cacheDir: string;
  maxEntries?: number;
}

export class CacheStore {
  private readonly cacheDir: string;
  private readonly maxEntries: number;
  private readonly indexPath: string;
  private index: CacheIndex | null = null;

  constructor(options: CacheStoreOptions) {
    this.cacheDir = options.cacheDir;
    this.maxEntries = options.maxEntries ?? 20;
    this.indexPath = path.join(this.cacheDir, 'index.json');
  }

  /**
   * Ensure cache directory exists
   */
  private async ensureDir(): Promise<void> {
    await fs.promises.mkdir(this.cacheDir, { recursive: true });
  }

  /**
   * Generate a unique cache entry ID
   */
  generateId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `cache-${timestamp}-${random}`;
  }

  /**
   * Load the cache index
   */
  private async loadIndex(): Promise<CacheIndex> {
    if (this.index) return this.index;

    try {
      const content = await fs.promises.readFile(this.indexPath, 'utf-8');
      this.index = CacheIndexSchema.parse(JSON.parse(content));
      return this.index;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.index = { entries: [], totalSize: 0 };
        return this.index;
      }
      throw error;
    }
  }

  /**
   * Save the cache index
   */
  private async saveIndex(): Promise<void> {
    await this.ensureDir();
    const content = JSON.stringify(this.index, null, 2);
    const tempPath = `${this.indexPath}.tmp`;
    await fs.promises.writeFile(tempPath, content, 'utf-8');
    await fs.promises.rename(tempPath, this.indexPath);
  }

  /**
   * Get path to a cache entry file
   */
  private getEntryPath(id: string): string {
    return path.join(this.cacheDir, `${id}.json`);
  }

  /**
   * Store a full context entry
   */
  async store(command: string, context: FullContext): Promise<string> {
    const id = this.generateId();
    const timestamp = new Date().toISOString();

    // Validate context
    const validated = FullContextSchema.parse(context);

    // Create entry
    const entry: CacheEntry = {
      id,
      timestamp,
      command,
      context: validated,
    };

    // Serialize and calculate size
    const content = JSON.stringify(entry, null, 2);
    const size = Buffer.byteLength(content, 'utf-8');

    // Write to disk
    await this.ensureDir();
    await fs.promises.writeFile(this.getEntryPath(id), content, 'utf-8');

    // Update index
    const index = await this.loadIndex();
    index.entries.push({
      id,
      command,
      timestamp,
      size,
    });
    index.totalSize += size;

    // Evict if necessary
    await this.evictIfNeeded(index);

    this.index = index;
    await this.saveIndex();

    logger.debug(`Cache entry stored: ${id}`, { command, size });
    return id;
  }

  /**
   * Evict old entries if over limit
   */
  private async evictIfNeeded(index: CacheIndex): Promise<void> {
    while (index.entries.length > this.maxEntries) {
      const oldest = index.entries.shift();
      if (oldest) {
        try {
          await fs.promises.unlink(this.getEntryPath(oldest.id));
          index.totalSize -= oldest.size;
          logger.debug(`Evicted cache entry: ${oldest.id}`);
        } catch (error) {
          logger.warn(`Failed to evict cache entry: ${oldest.id}`, { error });
        }
      }
    }
    if (index.entries.length > 0) {
      index.lastEviction = new Date().toISOString();
    }
  }

  /**
   * Get a cache entry by ID
   */
  async get(id: string): Promise<CacheEntry | null> {
    try {
      const content = await fs.promises.readFile(this.getEntryPath(id), 'utf-8');
      return JSON.parse(content) as CacheEntry;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Query specific data from a cache entry
   */
  async query(id: string, dataType: CacheDataType): Promise<string | null> {
    const entry = await this.get(id);
    if (!entry) return null;

    switch (dataType) {
      case 'snapshot':
        return entry.context.snapshot;
      case 'html':
        return entry.context.html;
      case 'screenshot':
        return entry.context.screenshot ?? null;
      case 'console':
        return JSON.stringify(entry.context.console, null, 2);
      case 'network':
        return JSON.stringify(entry.context.network, null, 2);
      default:
        return null;
    }
  }

  /**
   * List all cache entries
   */
  async list(): Promise<CacheIndexEntry[]> {
    const index = await this.loadIndex();
    return [...index.entries];
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{
    entryCount: number;
    totalSize: number;
    maxEntries: number;
    lastEviction?: string;
  }> {
    const index = await this.loadIndex();
    return {
      entryCount: index.entries.length,
      totalSize: index.totalSize,
      maxEntries: this.maxEntries,
      lastEviction: index.lastEviction,
    };
  }

  /**
   * Clear a specific cache entry
   */
  async delete(id: string): Promise<boolean> {
    const index = await this.loadIndex();
    const entryIndex = index.entries.findIndex((e) => e.id === id);

    if (entryIndex === -1) return false;

    const entry = index.entries[entryIndex];
    try {
      await fs.promises.unlink(this.getEntryPath(id));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    index.entries.splice(entryIndex, 1);
    index.totalSize -= entry.size;
    this.index = index;
    await this.saveIndex();

    logger.debug(`Cache entry deleted: ${id}`);
    return true;
  }

  /**
   * Clear all cache entries
   */
  async clear(): Promise<void> {
    const index = await this.loadIndex();

    for (const entry of index.entries) {
      try {
        await fs.promises.unlink(this.getEntryPath(entry.id));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          logger.warn(`Failed to delete cache entry: ${entry.id}`, { error });
        }
      }
    }

    this.index = { entries: [], totalSize: 0 };
    await this.saveIndex();

    logger.info('Cache cleared');
  }

  /**
   * Search cache entries by command
   */
  async search(commandPattern: string): Promise<CacheIndexEntry[]> {
    const index = await this.loadIndex();
    const pattern = commandPattern.toLowerCase();
    return index.entries.filter((e) =>
      e.command.toLowerCase().includes(pattern)
    );
  }

  /**
   * Get the most recent entry
   */
  async getLatest(): Promise<CacheEntry | null> {
    const index = await this.loadIndex();
    if (index.entries.length === 0) return null;

    const latest = index.entries[index.entries.length - 1];
    return this.get(latest.id);
  }

  /**
   * Get cache directory path
   */
  getCacheDir(): string {
    return this.cacheDir;
  }
}

/**
 * Create a cache store instance
 */
export function createCacheStore(cacheDir: string, maxEntries?: number): CacheStore {
  return new CacheStore({ cacheDir, maxEntries });
}
