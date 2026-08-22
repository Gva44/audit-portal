/**
 * Shared Types for Playwright Skill
 *
 * Core type definitions and Zod schemas for runtime validation.
 */

import { z } from 'zod';

// ============================================================================
// Auth Status
// ============================================================================

export const AuthStatusSchema = z.enum(['authenticated', 'unauthenticated', 'unknown']);
export type AuthStatus = z.infer<typeof AuthStatusSchema>;

// ============================================================================
// Browser Types
// ============================================================================

export const BrowserTypeSchema = z.enum(['chromium', 'firefox', 'webkit']);
export type BrowserType = z.infer<typeof BrowserTypeSchema>;

export const ViewportSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
}).nullable();
export type Viewport = z.infer<typeof ViewportSchema>;

// ============================================================================
// Console & Modal Types
// ============================================================================

export const ConsoleMessageTypeSchema = z.enum([
  'log', 'debug', 'info', 'error', 'warning', 'dir', 'dirxml',
  'table', 'trace', 'clear', 'startGroup', 'startGroupCollapsed',
  'endGroup', 'assert', 'profile', 'profileEnd', 'count', 'timeEnd'
]);
export type ConsoleMessageType = z.infer<typeof ConsoleMessageTypeSchema>;

export const ConsoleMessageSchema = z.object({
  type: ConsoleMessageTypeSchema,
  text: z.string(),
  timestamp: z.string(),
  location: z.object({
    url: z.string().optional(),
    lineNumber: z.number().optional(),
    columnNumber: z.number().optional(),
  }).optional(),
});
export type ConsoleMessage = z.infer<typeof ConsoleMessageSchema>;

// ModalState/DialogType removed in v2 — dialog race condition fixed by @playwright/cli.

// ============================================================================
// Cookie Type
// ============================================================================

export const CookieSameSiteSchema = z.enum(['Strict', 'Lax', 'None']);
export type CookieSameSite = z.infer<typeof CookieSameSiteSchema>;

export const CookieSchema = z.object({
  name: z.string(),
  value: z.string(),
  domain: z.string(),
  path: z.string(),
  expires: z.number(),
  httpOnly: z.boolean(),
  secure: z.boolean(),
  sameSite: CookieSameSiteSchema,
});
export type Cookie = z.infer<typeof CookieSchema>;

// ============================================================================
// Network Types
// ============================================================================

export const NetworkRequestSchema = z.object({
  url: z.string(),
  method: z.string(),
  status: z.number().optional(),
  statusText: z.string().optional(),
  resourceType: z.string(),
  timestamp: z.string(),
  duration: z.number().optional(),
});
export type NetworkRequest = z.infer<typeof NetworkRequestSchema>;

// Session and AuthProfile types removed in v2.
// Session lifecycle is managed by @playwright/cli.
// Auth profiles use playwright-cli state-save/state-load (storageState format).

// ============================================================================
// Tab Snapshot
// ============================================================================

export const TabSnapshotSchema = z.object({
  url: z.string(),
  title: z.string(),
  ariaSnapshot: z.string(),
  ariaSnapshotDiff: z.string().optional(),
  consoleMessages: z.array(ConsoleMessageSchema),
});
export type TabSnapshot = z.infer<typeof TabSnapshotSchema>;

// ============================================================================
// Cache Types
// ============================================================================

export const CacheDataTypeSchema = z.enum(['snapshot', 'html', 'screenshot', 'console', 'network']);
export type CacheDataType = z.infer<typeof CacheDataTypeSchema>;

export const TimingSchema = z.object({
  commandStart: z.number(),
  commandEnd: z.number(),
  snapshotTime: z.number(),
});
export type Timing = z.infer<typeof TimingSchema>;

export const FullContextSchema = z.object({
  snapshot: z.string(),
  html: z.string(),
  screenshot: z.string().optional(),
  console: z.array(ConsoleMessageSchema),
  network: z.array(NetworkRequestSchema),
  cookies: z.array(CookieSchema),
  timing: TimingSchema,
});
export type FullContext = z.infer<typeof FullContextSchema>;

export const CacheEntrySchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  command: z.string(),
  context: FullContextSchema,
});
export type CacheEntry = z.infer<typeof CacheEntrySchema>;

export const CacheIndexEntrySchema = z.object({
  id: z.string(),
  command: z.string(),
  timestamp: z.string(),
  size: z.number(),
});
export type CacheIndexEntry = z.infer<typeof CacheIndexEntrySchema>;

export const CacheIndexSchema = z.object({
  entries: z.array(CacheIndexEntrySchema),
  totalSize: z.number(),
  lastEviction: z.string().optional(),
});
export type CacheIndex = z.infer<typeof CacheIndexSchema>;

// ============================================================================
// Response Types
// ============================================================================

export const PageStateSchema = z.object({
  url: z.string(),
  title: z.string(),
  authStatus: AuthStatusSchema,
  hasErrors: z.boolean(),
});
export type PageState = z.infer<typeof PageStateSchema>;

export const CacheRefSchema = z.object({
  id: z.string(),
  available: z.array(CacheDataTypeSchema),
});
export type CacheRef = z.infer<typeof CacheRefSchema>;

export const ErrorInfoSchema = z.object({
  message: z.string(),
  suggestion: z.string().optional(),
});
export type ErrorInfo = z.infer<typeof ErrorInfoSchema>;

export const TrimmedResponseSchema = z.object({
  id: z.string(),
  command: z.string(),
  success: z.boolean(),
  action: z.string(),
  result: z.any().optional(),
  error: ErrorInfoSchema.optional(),
  pageState: PageStateSchema,
  cacheRef: CacheRefSchema,
  suggestions: z.array(z.string()).optional(),
});
export type TrimmedResponse = z.infer<typeof TrimmedResponseSchema>;

// ============================================================================
// Observability Types
// ============================================================================

export const CacheAccessLogSchema = z.object({
  timestamp: z.string(),
  requestId: z.string(),
  cacheId: z.string(),
  dataType: CacheDataTypeSchema,
  hitOrMiss: z.enum(['hit', 'miss']),
  reason: z.string().optional(),
});
export type CacheAccessLog = z.infer<typeof CacheAccessLogSchema>;

// CLIConfig removed in v2 — no custom CLI. Configuration is via playwright-cli flags.

// ============================================================================
// Command Result Type
// ============================================================================

export interface CommandResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: Error;
}
