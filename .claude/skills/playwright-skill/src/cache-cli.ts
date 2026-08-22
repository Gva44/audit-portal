/**
 * Cache CLI (v2)
 *
 * CLI wrapper for CacheStore. Provides subcommands for querying and managing
 * the playwright-skill cache.
 *
 * Usage:
 *   node dist/cache-cli.js query <id> <dataType>
 *   node dist/cache-cli.js list
 *   node dist/cache-cli.js stats
 *   node dist/cache-cli.js clear [id]
 */

import * as path from 'path';
import { fileURLToPath } from 'url';
import { CacheStore } from './cache/CacheStore.js';
import type { CacheDataType } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(SKILL_ROOT, '.playwright-skill', 'cache');

const VALID_DATA_TYPES: CacheDataType[] = ['snapshot', 'html', 'screenshot', 'console', 'network'];

function usage(): void {
  process.stderr.write(`Usage:
  cache-query query <id> <dataType>   Query a specific data type from a cache entry
  cache-query list                    List all cache entries as JSON
  cache-query stats                   Print cache statistics as JSON
  cache-query clear [id]              Clear one entry or all entries

Data types: ${VALID_DATA_TYPES.join(', ')}
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const subcommand = args[0];

  if (!subcommand) {
    usage();
    process.exit(1);
  }

  const cache = new CacheStore({ cacheDir: CACHE_DIR });

  switch (subcommand) {
    case 'query': {
      const id = args[1];
      const dataType = args[2] as CacheDataType | undefined;

      if (!id || !dataType) {
        process.stderr.write('cache-query: error: query requires <id> and <dataType>\n');
        usage();
        process.exit(1);
      }

      if (!VALID_DATA_TYPES.includes(dataType)) {
        process.stderr.write(`cache-query: error: unknown data type '${dataType}'. Valid: ${VALID_DATA_TYPES.join(', ')}\n`);
        process.exit(1);
      }

      const result = await cache.query(id, dataType);

      if (result === null) {
        process.stderr.write(`cache-query: error: entry '${id}' not found or data type '${dataType}' unavailable\n`);
        process.exit(1);
      }

      process.stdout.write(result + '\n');
      break;
    }

    case 'list': {
      const entries = await cache.list();
      process.stdout.write(JSON.stringify(entries, null, 2) + '\n');
      break;
    }

    case 'stats': {
      const stats = await cache.getStats();
      process.stdout.write(JSON.stringify(stats, null, 2) + '\n');
      break;
    }

    case 'clear': {
      const id = args[1];

      if (id) {
        const deleted = await cache.delete(id);
        if (!deleted) {
          process.stderr.write(`cache-query: error: entry '${id}' not found\n`);
          process.exit(1);
        }
        process.stdout.write(`Cleared cache entry: ${id}\n`);
      } else {
        await cache.clear();
        process.stdout.write('Cache cleared.\n');
      }
      break;
    }

    default: {
      process.stderr.write(`cache-query: error: unknown subcommand '${subcommand}'\n`);
      usage();
      process.exit(1);
    }
  }
}

main().catch((err) => {
  process.stderr.write(`cache-query: fatal error: ${String(err)}\n`);
  process.exit(1);
});
