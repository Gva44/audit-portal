/**
 * Context Capture Entry Point (v2)
 *
 * Collects full page context via playwright-cli commands and browser injection,
 * stores it in CacheStore, and outputs a compact TrimmedResponse to stdout.
 *
 * Usage: node dist/capture.js [--screenshot]
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { CacheStore } from './cache/CacheStore.js';
import { ResponseBuilder } from './response/ResponseBuilder.js';
import type { ConsoleMessage, NetworkRequest, Cookie, TabSnapshot, TrimmedResponse } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(SKILL_ROOT, '.playwright-skill', 'cache');

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

/**
 * Check whether the named session (or any session) is currently open.
 * Uses `playwright-cli list` and scans the output for the session name
 * followed by `status: open` within the next few lines.
 */
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

function noSessionResponse(sessionName: string | null): TrimmedResponse {
  const suggestions = sessionName
    ? [
        `Run: bin/open --headed   # resumes session '${sessionName}'`,
        'If the session is stuck: playwright-cli kill-all  then  bin/open --headed',
      ]
    : [
        'Run: bin/open --headed   # auto-names session from current directory',
        'Or:  bin/open --headed --session <name>',
      ];

  return {
    id: 'err-no-session',
    command: 'context',
    success: false,
    action: sessionName
      ? `No browser session '${sessionName}' is open`
      : 'No browser session configured — use bin/open instead of playwright-cli open',
    pageState: { url: 'about:blank', title: '', authStatus: 'unknown', hasErrors: false },
    cacheRef: { id: '', available: [] },
    suggestions,
  };
}

// ---------------------------------------------------------------------------
// playwright-cli runner
// ---------------------------------------------------------------------------

/**
 * Run playwright-cli with the given args, return stdout as string.
 * Stderr is inherited (visible to user).
 */
function runCli(sessionArgs: string[], commandArgs: string[]): string {
  try {
    return execFileSync('playwright-cli', [...sessionArgs, ...commandArgs], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'inherit'],
    });
  } catch (err: unknown) {
    const e = err as { stdout?: string };
    return e.stdout ?? '';
  }
}

// ---------------------------------------------------------------------------
// Output parsing helpers
// ---------------------------------------------------------------------------

/**
 * Parse the file path emitted by playwright-cli from its output.
 * playwright-cli prints lines like:
 *   - [Snapshot](.playwright-cli/page-1234567890.yml)
 */
function parseFilePath(output: string, prefix: string): string | null {
  const regex = new RegExp(`\\[${prefix}\\]\\(([^)]+)\\)`);
  const match = regex.exec(output);
  return match ? match[1] : null;
}

/**
 * Parse playwright-cli console log format into ConsoleMessage array.
 * Format: [LEVEL] message text @ url:line
 */
function parseConsoleLog(raw: string): ConsoleMessage[] {
  const messages: ConsoleMessage[] = [];
  const lineRegex = /^\[(ERROR|WARNING|LOG|INFO|DEBUG)\]\s+(.+?)(?:\s+@\s+(.+):(\d+))?$/;

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = lineRegex.exec(trimmed);
    if (!match) continue;

    const [, levelRaw, text, url, lineNum] = match;

    const typeMap: Record<string, ConsoleMessage['type']> = {
      ERROR: 'error',
      WARNING: 'warning',
      LOG: 'log',
      INFO: 'info',
      DEBUG: 'debug',
    };

    const message: ConsoleMessage = {
      type: typeMap[levelRaw] ?? 'log',
      text,
      timestamp: new Date().toISOString(),
    };

    if (url || lineNum) {
      message.location = {
        url: url ?? undefined,
        lineNumber: lineNum ? parseInt(lineNum, 10) : undefined,
      };
    }

    messages.push(message);
  }

  return messages;
}

/**
 * Merge two console message arrays, deduplicating by type+text.
 */
function mergeConsole(
  playwrightMsgs: ConsoleMessage[],
  injectedMsgs: ConsoleMessage[] | null
): ConsoleMessage[] {
  if (!injectedMsgs || injectedMsgs.length === 0) return playwrightMsgs;

  const seen = new Set(playwrightMsgs.map((m) => `${m.type}:${m.text}`));
  const merged = [...playwrightMsgs];

  for (const msg of injectedMsgs) {
    const key = `${msg.type}:${msg.text}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(msg);
    }
  }

  return merged;
}

// ---------------------------------------------------------------------------
// PAGE_DATA_CODE — passed as raw arg to playwright-cli run-code
// ---------------------------------------------------------------------------

const PAGE_DATA_CODE = `async page => {
  const cookies = await page.context().cookies();
  const html = await page.evaluate(() => document.documentElement.outerHTML);
  const capturedConsole = await page.evaluate(() => window.__capturedConsole ?? null);
  const capturedRequests = await page.evaluate(() => window.__capturedRequests ?? null);
  const hasCapture = capturedConsole !== null;
  return { url: page.url(), title: await page.title(), html, cookies, capturedConsole, capturedRequests, hasCapture };
}`;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const wantScreenshot = args.includes('--screenshot');

  // 1. Resolve session
  const sessionName = readSessionName();

  if (!sessionName) {
    process.stdout.write(JSON.stringify(noSessionResponse(null), null, 2) + '\n');
    return;
  }

  if (!sessionIsOpen(sessionName)) {
    process.stdout.write(JSON.stringify(noSessionResponse(sessionName), null, 2) + '\n');
    return;
  }

  const sessionArgs = [`-s=${sessionName}`];

  // 2. Snapshot
  const snapshotOutput = runCli(sessionArgs, ['snapshot']);
  const snapshotFilePath = parseFilePath(snapshotOutput, 'Snapshot');
  let ariaSnapshot = '';
  if (snapshotFilePath) {
    const resolvedPath = path.resolve(SKILL_ROOT, snapshotFilePath);
    try {
      ariaSnapshot = fs.readFileSync(resolvedPath, 'utf-8');
    } catch { /* proceed with empty */ }
  }

  // 3. Console
  const consoleOutput = runCli(sessionArgs, ['console']);
  const consoleFilePath = parseFilePath(consoleOutput, 'Console log');
  let playwrightConsole: ConsoleMessage[] = [];
  if (consoleFilePath) {
    const resolvedPath = path.resolve(SKILL_ROOT, consoleFilePath);
    try {
      playwrightConsole = parseConsoleLog(fs.readFileSync(resolvedPath, 'utf-8'));
    } catch { /* ignore */ }
  }

  // 4. Network
  const networkOutput = runCli(sessionArgs, ['network']);
  const networkFilePath = parseFilePath(networkOutput, 'Network log');
  let networkRaw = '';
  if (networkFilePath) {
    const resolvedPath = path.resolve(SKILL_ROOT, networkFilePath);
    try {
      networkRaw = fs.readFileSync(resolvedPath, 'utf-8');
    } catch { /* ignore */ }
  }
  const networkRequests: NetworkRequest[] = parseNetworkLog(networkRaw);

  // 5. Page data via run-code
  const pageDataOutput = runCli(sessionArgs, ['run-code', PAGE_DATA_CODE]);
  const pageData = parseRunCodeResult(pageDataOutput);

  // 6. Optional screenshot
  let screenshotBuffer: Buffer | undefined;
  if (wantScreenshot) {
    const screenshotOutput = runCli(sessionArgs, ['screenshot']);
    const screenshotPath = parseScreenshotPath(screenshotOutput);
    if (screenshotPath) {
      const resolvedPath = path.resolve(SKILL_ROOT, screenshotPath);
      try {
        screenshotBuffer = fs.readFileSync(resolvedPath);
      } catch { /* ignore */ }
    }
  }

  // 7. Merge console + network
  const mergedConsole = mergeConsole(playwrightConsole, pageData?.capturedConsole ?? null);
  const injectedRequests = parseInjectedRequests(pageData?.capturedRequests ?? null);
  const mergedNetwork = mergeNetwork(networkRequests, injectedRequests);

  // 8. Build and store
  const cookies: Cookie[] = normalizeCookies(pageData?.cookies ?? []);
  const url = pageData?.url ?? 'about:blank';
  const title = pageData?.title ?? '';
  const html = pageData?.html ?? '';

  const tabSnapshot: TabSnapshot = {
    url,
    title,
    ariaSnapshot,
    consoleMessages: mergedConsole,
  };

  const cache = new CacheStore({ cacheDir: CACHE_DIR });
  const builder = new ResponseBuilder({ cache, sessionName });

  const response = await builder.build({
    command: 'context',
    success: true,
    action: `Captured page context for ${url}`,
    snapshot: tabSnapshot,
    html,
    screenshot: screenshotBuffer,
    consoleMessages: mergedConsole,
    networkRequests: mergedNetwork,
    cookies,
  });

  process.stdout.write(JSON.stringify(response, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

interface PageData {
  url: string;
  title: string;
  html: string;
  cookies: unknown[];
  capturedConsole: ConsoleMessage[] | null;
  capturedRequests: unknown[] | null;
  hasCapture: boolean;
}

function parseRunCodeResult(output: string): PageData | null {
  const marker = '### Result\n';
  const idx = output.indexOf(marker);
  if (idx === -1) return null;
  try {
    return JSON.parse(output.slice(idx + marker.length).trim()) as PageData;
  } catch {
    return null;
  }
}

function parseScreenshotPath(output: string): string | null {
  const match = /\.playwright-cli\/screenshot-[^\s)]+\.png/.exec(output);
  return match ? match[0] : null;
}

function parseNetworkLog(raw: string): NetworkRequest[] {
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as NetworkRequest[];
  } catch { /* try line format */ }

  const requests: NetworkRequest[] = [];
  const lineRegex = /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\d{3})?\s*(https?:\/\/\S+)/i;
  for (const line of raw.split('\n')) {
    const match = lineRegex.exec(line.trim());
    if (match) {
      requests.push({
        url: match[3],
        method: match[1].toUpperCase(),
        status: match[2] ? parseInt(match[2], 10) : undefined,
        resourceType: 'xhr',
        timestamp: new Date().toISOString(),
      });
    }
  }
  return requests;
}

function parseInjectedRequests(raw: unknown[] | null): NetworkRequest[] {
  if (!raw || !Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    .map((r) => ({
      url: String(r['url'] ?? ''),
      method: String(r['method'] ?? 'GET').toUpperCase(),
      status: typeof r['status'] === 'number' ? r['status'] : undefined,
      statusText: typeof r['statusText'] === 'string' ? r['statusText'] : undefined,
      resourceType: 'fetch',
      timestamp: typeof r['timestamp'] === 'string' ? r['timestamp'] : new Date().toISOString(),
      duration: typeof r['duration'] === 'number' ? r['duration'] : undefined,
    }));
}

function mergeNetwork(playwright: NetworkRequest[], injected: NetworkRequest[]): NetworkRequest[] {
  if (injected.length === 0) return playwright;
  const seen = new Set(playwright.map((r) => `${r.method}:${r.url}`));
  const merged = [...playwright];
  for (const req of injected) {
    const key = `${req.method}:${req.url}`;
    if (!seen.has(key)) { seen.add(key); merged.push(req); }
  }
  return merged;
}

function normalizeCookies(raw: unknown[]): Cookie[] {
  return raw
    .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
    .map((c) => ({
      name: String(c['name'] ?? ''),
      value: String(c['value'] ?? ''),
      domain: String(c['domain'] ?? ''),
      path: String(c['path'] ?? '/'),
      expires: typeof c['expires'] === 'number' ? c['expires'] : -1,
      httpOnly: Boolean(c['httpOnly']),
      secure: Boolean(c['secure']),
      sameSite: normalizeSameSite(c['sameSite']),
    }));
}

function normalizeSameSite(raw: unknown): 'Strict' | 'Lax' | 'None' {
  if (raw === 'Strict' || raw === 'Lax' || raw === 'None') return raw;
  return 'Lax';
}

main().catch((err) => {
  process.stderr.write(`capture: fatal error: ${String(err)}\n`);
  process.exit(1);
});
