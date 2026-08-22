/**
 * Response Builder
 *
 * Builds trimmed responses (~200 tokens) while storing full context in cache.
 * Handles auth status detection and error formatting.
 */

import type {
  TrimmedResponse,
  PageState,
  CacheRef,
  FullContext,
  AuthStatus,
  ErrorInfo,
  ConsoleMessage,
  NetworkRequest,
  Cookie,
  TabSnapshot,
  CacheDataType,
} from '../types.js';
import { CacheStore } from '../cache/CacheStore.js';
import { getLogger } from '../logging/index.js';

const logger = getLogger().child('ResponseBuilder');

export interface ResponseBuilderOptions {
  cache: CacheStore;
  sessionName: string;
}

export interface BuildOptions {
  command: string;
  success: boolean;
  action: string;
  result?: unknown;
  error?: Error | string;
  snapshot?: TabSnapshot;
  html?: string;
  screenshot?: Buffer;
  consoleMessages?: ConsoleMessage[];
  networkRequests?: NetworkRequest[];
  cookies?: Cookie[];
  suggestions?: string[];
}

export class ResponseBuilder {
  private readonly cache: CacheStore;
  private readonly sessionName: string;
  private requestCounter = 0;

  constructor(options: ResponseBuilderOptions) {
    this.cache = options.cache;
    this.sessionName = options.sessionName;
  }

  /**
   * Generate a unique request ID
   */
  private generateRequestId(): string {
    const date = new Date().toISOString().slice(0, 10);
    return `req-${date}-${++this.requestCounter}`;
  }

  /**
   * Detect auth status from page state
   */
  detectAuthStatus(url: string, cookies: Cookie[], html?: string): AuthStatus {
    // Check for common auth indicators in cookies
    const hasSessionCookie = cookies.some((c) =>
      /session|auth|token|jwt|sid/i.test(c.name)
    );

    // Check URL patterns that indicate auth state
    const isLoginPage = /\/(login|signin|auth|authenticate)/i.test(url);
    const isLogoutRedirect = /\/(logout|signout|logged-out)/i.test(url);

    if (isLogoutRedirect) {
      return 'unauthenticated';
    }

    if (hasSessionCookie && !isLoginPage) {
      return 'authenticated';
    }

    if (isLoginPage) {
      return 'unauthenticated';
    }

    // Check HTML for auth indicators if provided
    if (html) {
      const lowerHtml = html.toLowerCase();
      if (
        lowerHtml.includes('logout') ||
        lowerHtml.includes('sign out') ||
        lowerHtml.includes('my account') ||
        lowerHtml.includes('profile')
      ) {
        return 'authenticated';
      }
      if (
        lowerHtml.includes('please login') ||
        lowerHtml.includes('sign in to continue') ||
        lowerHtml.includes('create an account')
      ) {
        return 'unauthenticated';
      }
    }

    return 'unknown';
  }

  /**
   * Check if there are console errors
   */
  private hasErrors(consoleMessages?: ConsoleMessage[]): boolean {
    return consoleMessages?.some((m) => m.type === 'error') ?? false;
  }

  /**
   * Format an error for response
   */
  formatError(error: Error | string): ErrorInfo {
    const message = typeof error === 'string' ? error : error.message;

    // Generate suggestions based on error type
    let suggestion: string | undefined;

    if (message.includes('Timeout')) {
      suggestion = 'Try increasing timeout or waiting for a specific element';
    } else if (message.includes('not found') || message.includes('no element')) {
      suggestion = 'The element may have changed. Capture a new snapshot to get updated references.';
    } else if (message.includes('navigation')) {
      suggestion = 'The page may be loading. Wait for navigation to complete.';
    } else if (message.includes('dialog')) {
      suggestion = 'Handle the dialog before continuing with other actions.';
    } else if (message.includes('detached') || message.includes('removed')) {
      suggestion = 'The element was removed from the page. Capture a new snapshot.';
    }

    return {
      message,
      suggestion,
    };
  }

  /**
   * Build page state from snapshot and cookies
   */
  buildPageState(
    url: string,
    title: string,
    cookies: Cookie[],
    html?: string,
    consoleMessages?: ConsoleMessage[]
  ): PageState {
    return {
      url,
      title,
      authStatus: this.detectAuthStatus(url, cookies, html),
      hasErrors: this.hasErrors(consoleMessages),
    };
  }

  /**
   * Store full context in cache and return reference
   */
  private async storeFullContext(
    command: string,
    options: BuildOptions
  ): Promise<CacheRef> {
    const now = Date.now();

    const fullContext: FullContext = {
      snapshot: options.snapshot?.ariaSnapshot ?? '',
      html: options.html ?? '',
      screenshot: options.screenshot?.toString('base64'),
      console: options.consoleMessages ?? [],
      network: options.networkRequests ?? [],
      cookies: options.cookies ?? [],
      timing: {
        commandStart: now - 100, // Approximate
        commandEnd: now,
        snapshotTime: now,
      },
    };

    const cacheId = await this.cache.store(command, fullContext);

    const available: CacheDataType[] = ['snapshot', 'console', 'network'];
    if (options.html) available.push('html');
    if (options.screenshot) available.push('screenshot');

    return {
      id: cacheId,
      available,
    };
  }

  /**
   * Build a trimmed response
   */
  async build(options: BuildOptions): Promise<TrimmedResponse> {
    const requestId = this.generateRequestId();

    // Store full context in cache
    const cacheRef = await this.storeFullContext(options.command, options);

    // Build page state
    const url = options.snapshot?.url ?? 'about:blank';
    const title = options.snapshot?.title ?? '';
    const pageState = this.buildPageState(
      url,
      title,
      options.cookies ?? [],
      options.html,
      options.consoleMessages
    );

    // Build response
    const response: TrimmedResponse = {
      id: requestId,
      command: options.command,
      success: options.success,
      action: options.action,
      pageState,
      cacheRef,
    };

    // Add optional fields
    if (options.result !== undefined) {
      response.result = options.result;
    }

    if (options.error) {
      response.error = this.formatError(options.error);
    }

    if (options.suggestions && options.suggestions.length > 0) {
      response.suggestions = options.suggestions;
    }

    logger.debug(`Response built: ${requestId}`, {
      command: options.command,
      success: options.success,
      cacheId: cacheRef.id,
    });

    return response;
  }

  /**
   * Build a success response
   */
  async success(
    command: string,
    action: string,
    options: Omit<BuildOptions, 'command' | 'success' | 'action'>
  ): Promise<TrimmedResponse> {
    return this.build({
      ...options,
      command,
      success: true,
      action,
    });
  }

  /**
   * Build an error response
   */
  async error(
    command: string,
    error: Error | string,
    options: Partial<Omit<BuildOptions, 'command' | 'success' | 'error'>> = {}
  ): Promise<TrimmedResponse> {
    const errorInfo = this.formatError(error);

    return this.build({
      ...options,
      command,
      success: false,
      action: `Failed: ${errorInfo.message}`,
      error,
      suggestions: options.suggestions ?? (errorInfo.suggestion ? [errorInfo.suggestion] : undefined),
    });
  }

  /**
   * Get the underlying cache store
   */
  getCache(): CacheStore {
    return this.cache;
  }

  /**
   * Get session name
   */
  getSessionName(): string {
    return this.sessionName;
  }
}

/**
 * Create a response builder instance
 */
export function createResponseBuilder(
  cache: CacheStore,
  sessionName: string
): ResponseBuilder {
  return new ResponseBuilder({ cache, sessionName });
}
