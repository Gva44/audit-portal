/**
 * Browser-Side Capture Injection (v2)
 *
 * Patches console and fetch in the browser so events are captured in
 * window.__capturedConsole and window.__capturedRequests.
 * These are then read by bin/context via run-code.
 *
 * Usage: node dist/inject.js
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the session file path based on CLAUDE_SESSION_ID.
 * When set, each agent gets its own file under .playwright-skill/sessions/.
 * When unset, falls back to the legacy .playwright-skill/session file.
 */
function resolveSessionFile(): string {
  const claudeSessionId = process.env.CLAUDE_SESSION_ID;
  if (claudeSessionId) {
    // Sanitize: strip anything that isn't alphanumeric, dash, or underscore (defense in depth)
    const safeId = claudeSessionId.replace(/[^a-zA-Z0-9_-]/g, '');
    if (safeId) {
      return path.join(SKILL_ROOT, '.playwright-skill', 'sessions', safeId);
    }
  }
  return path.join(SKILL_ROOT, '.playwright-skill', 'session');
}

function readSessionName(): string | null {
  try {
    const name = fs.readFileSync(resolveSessionFile(), 'utf-8').trim();
    return name || null;
  } catch {
    return null;
  }
}

function sessionIsOpen(sessionName: string): boolean {
  try {
    const output = execFileSync('playwright-cli', ['list'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
    });
    const lines = output.split('\n');
    const idx = lines.findIndex((l) => l.trim() === `- ${sessionName}:`);
    if (idx === -1) return false;
    const context = lines.slice(idx + 1, idx + 7).join('\n');
    return context.includes('status: open');
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Injection code strings
// ---------------------------------------------------------------------------

const CONSOLE_PATCH_CODE = `async page => {
  await page.evaluate(() => {
    if (window.__pw_console_patched) return;
    window.__pw_console_patched = true;
    window.__capturedConsole = [];

    const levels = ['error', 'warn', 'log', 'info', 'debug'];
    for (const level of levels) {
      const original = console[level].bind(console);
      console[level] = (...args) => {
        original(...args);
        window.__capturedConsole.push({
          type: level === 'warn' ? 'warning' : level,
          text: args.map(a => {
            try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
            catch { return String(a); }
          }).join(' '),
          timestamp: new Date().toISOString(),
        });
      };
    }
  });
}`;

const FETCH_PATCH_CODE = `async page => {
  await page.evaluate(() => {
    if (window.__pw_fetch_patched) return;
    window.__pw_fetch_patched = true;
    window.__capturedRequests = [];

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const start = Date.now();
      try {
        const response = await originalFetch(input, init);
        window.__capturedRequests.push({
          url, method, status: response.status, statusText: response.statusText,
          resourceType: 'fetch', timestamp: new Date().toISOString(), duration: Date.now() - start,
        });
        return response;
      } catch (err) {
        window.__capturedRequests.push({
          url, method, resourceType: 'fetch',
          timestamp: new Date().toISOString(), duration: Date.now() - start,
        });
        throw err;
      }
    };

    const OrigXHR = window.XMLHttpRequest;
    window.XMLHttpRequest = class PatchedXHR extends OrigXHR {
      constructor() { super(); this.__url = ''; this.__method = 'GET'; this.__start = 0; }
      open(method, url, ...rest) {
        this.__url = url; this.__method = method.toUpperCase();
        return super.open(method, url, ...rest);
      }
      send(...args) {
        this.__start = Date.now();
        this.addEventListener('loadend', () => {
          window.__capturedRequests.push({
            url: this.__url, method: this.__method,
            status: this.status, statusText: this.statusText,
            resourceType: 'xhr', timestamp: new Date().toISOString(),
            duration: Date.now() - this.__start,
          });
        });
        return super.send(...args);
      }
    };
  });
}`;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function runCli(args: string[]): void {
  execFileSync('playwright-cli', args, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

function main(): void {
  const sessionName = readSessionName();

  if (!sessionName) {
    const result = {
      success: false,
      hasCapture: false,
      error: 'No browser session configured — use bin/open instead of playwright-cli open',
      suggestions: ['Run: bin/open --headed'],
    };
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  if (!sessionIsOpen(sessionName)) {
    const result = {
      success: false,
      hasCapture: false,
      error: `No browser session '${sessionName}' is open`,
      suggestions: [
        `Run: bin/open --headed   # resumes session '${sessionName}'`,
        'If the session is stuck: playwright-cli kill-all  then  bin/open --headed',
      ],
    };
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  const sessionArgs = [`-s=${sessionName}`];

  runCli([...sessionArgs, 'run-code', CONSOLE_PATCH_CODE]);
  runCli([...sessionArgs, 'run-code', FETCH_PATCH_CODE]);

  const result = { success: true, hasCapture: true, session: sessionName };
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

try {
  main();
} catch (err) {
  process.stderr.write(`inject: fatal error: ${String(err)}\n`);
  process.exit(1);
}
