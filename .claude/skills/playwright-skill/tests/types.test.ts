/**
 * Tests for shared types and Zod schemas
 */

import { describe, it, expect } from 'vitest';
import {
  TrimmedResponseSchema,
  CookieSchema,
  ConsoleMessageSchema,
  FullContextSchema,
  CacheEntrySchema,
  AuthStatusSchema,
  BrowserTypeSchema,
} from '../src/types.js';

describe('AuthStatusSchema', () => {
  it('accepts valid auth statuses', () => {
    expect(AuthStatusSchema.parse('authenticated')).toBe('authenticated');
    expect(AuthStatusSchema.parse('unauthenticated')).toBe('unauthenticated');
    expect(AuthStatusSchema.parse('unknown')).toBe('unknown');
  });

  it('rejects invalid auth status', () => {
    expect(() => AuthStatusSchema.parse('invalid')).toThrow();
  });
});

describe('BrowserTypeSchema', () => {
  it('accepts valid browser types', () => {
    expect(BrowserTypeSchema.parse('chromium')).toBe('chromium');
    expect(BrowserTypeSchema.parse('firefox')).toBe('firefox');
    expect(BrowserTypeSchema.parse('webkit')).toBe('webkit');
  });

  it('rejects invalid browser type', () => {
    expect(() => BrowserTypeSchema.parse('safari')).toThrow();
  });
});

// SessionSchema removed in v2 — sessions managed by @playwright/cli

describe('CookieSchema', () => {
  it('validates a complete cookie', () => {
    const cookie = {
      name: 'session_id',
      value: 'abc123',
      domain: 'example.com',
      path: '/',
      expires: Date.now() + 3600000,
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
    };

    const result = CookieSchema.parse(cookie);
    expect(result.name).toBe('session_id');
    expect(result.sameSite).toBe('Strict');
  });

  it('rejects invalid sameSite value', () => {
    const cookie = {
      name: 'session_id',
      value: 'abc123',
      domain: 'example.com',
      path: '/',
      expires: Date.now(),
      httpOnly: true,
      secure: true,
      sameSite: 'Invalid',
    };

    expect(() => CookieSchema.parse(cookie)).toThrow();
  });
});

describe('ConsoleMessageSchema', () => {
  it('validates a console message', () => {
    const message = {
      type: 'log',
      text: 'Hello, world!',
      timestamp: '2025-12-20T00:00:00Z',
    };

    const result = ConsoleMessageSchema.parse(message);
    expect(result.type).toBe('log');
    expect(result.text).toBe('Hello, world!');
  });

  it('validates console message with location', () => {
    const message = {
      type: 'error',
      text: 'Error occurred',
      timestamp: '2025-12-20T00:00:00Z',
      location: {
        url: 'https://example.com/script.js',
        lineNumber: 42,
        columnNumber: 10,
      },
    };

    const result = ConsoleMessageSchema.parse(message);
    expect(result.location?.lineNumber).toBe(42);
  });
});

describe('TrimmedResponseSchema', () => {
  it('validates a successful response', () => {
    const response = {
      id: 'req-123',
      command: 'navigate',
      success: true,
      action: 'Navigated to https://example.com',
      pageState: {
        url: 'https://example.com',
        title: 'Example',
        authStatus: 'unknown',
        hasErrors: false,
      },
      cacheRef: {
        id: 'req-123',
        available: ['snapshot', 'html'],
      },
    };

    const result = TrimmedResponseSchema.parse(response);
    expect(result.success).toBe(true);
    expect(result.pageState.url).toBe('https://example.com');
  });

  it('validates an error response', () => {
    const response = {
      id: 'req-123',
      command: 'click',
      success: false,
      action: 'Failed to click element',
      error: {
        message: 'Element not found',
        suggestion: 'Run snapshot to get valid refs',
      },
      pageState: {
        url: 'https://example.com',
        title: 'Example',
        authStatus: 'authenticated',
        hasErrors: true,
      },
      cacheRef: {
        id: 'req-123',
        available: ['snapshot'],
      },
    };

    const result = TrimmedResponseSchema.parse(response);
    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('Element not found');
  });

  it('validates response with suggestions', () => {
    const response = {
      id: 'req-123',
      command: 'navigate',
      success: true,
      action: 'Navigated',
      pageState: {
        url: 'https://example.com/login',
        title: 'Login',
        authStatus: 'unauthenticated',
        hasErrors: false,
      },
      cacheRef: {
        id: 'req-123',
        available: [],
      },
      suggestions: ['Use auth load to restore session', 'Fill login form'],
    };

    const result = TrimmedResponseSchema.parse(response);
    expect(result.suggestions).toHaveLength(2);
  });
});

describe('FullContextSchema', () => {
  it('validates a complete full context', () => {
    const context = {
      snapshot: '<accessibility tree>',
      html: '<html><body>Hello</body></html>',
      screenshot: 'base64encodedimage',
      console: [
        { type: 'log', text: 'Loaded', timestamp: '2025-12-20T00:00:00Z' },
      ],
      network: [
        {
          url: 'https://example.com',
          method: 'GET',
          status: 200,
          statusText: 'OK',
          resourceType: 'document',
          timestamp: '2025-12-20T00:00:00Z',
          duration: 150,
        },
      ],
      cookies: [],
      timing: {
        commandStart: 1000,
        commandEnd: 1500,
        snapshotTime: 50,
      },
    };

    const result = FullContextSchema.parse(context);
    expect(result.snapshot).toBe('<accessibility tree>');
    expect(result.network).toHaveLength(1);
  });
});

describe('CacheEntrySchema', () => {
  it('validates a cache entry', () => {
    const entry = {
      id: 'req-123',
      timestamp: '2025-12-20T00:00:00Z',
      command: 'navigate',
      context: {
        snapshot: '<tree>',
        html: '<html></html>',
        console: [],
        network: [],
        cookies: [],
        timing: {
          commandStart: 1000,
          commandEnd: 1500,
          snapshotTime: 50,
        },
      },
    };

    const result = CacheEntrySchema.parse(entry);
    expect(result.id).toBe('req-123');
    expect(result.command).toBe('navigate');
  });
});
