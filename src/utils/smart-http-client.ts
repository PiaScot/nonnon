/**
 * Smart HTTP client with 2-stage fallback strategy
 *
 * Strategy:
 * 1. Try crawlee (got-scraping) - Best for Cloudflare/Bot protection
 * 2. Fall back to legacy fetch - Lightweight but may be blocked
 *
 * Note: Playwright removed - Flutter InAppWebView handles dynamic content
 */

import { gotScraping } from 'crawlee';
import { fetchHtml as legacyFetchHtml } from './http-client.js';
import { logDebug, logWarn, logError, logInfo } from './logger.js';

export type FetchStrategy = 'crawlee' | 'fetch';
export type UserAgentType = 'mobile' | 'pc';

interface SmartFetchOptions {
  strategy?: FetchStrategy;
  userAgent?: UserAgentType;
  timeout?: number;
  maxRetries?: number;
}

/**
 * Fetch HTML with crawlee (got-scraping)
 * Best for Cloudflare and bot protection bypass
 */
async function fetchWithCrawlee(
  url: string,
  userAgent: UserAgentType = 'mobile',
  timeout: number = 30000
): Promise<string | null> {
  try {
    logDebug(`Fetching with crawlee: ${url}`);

    const response = await gotScraping({
      url,
      headerGeneratorOptions: {
        browsers: [
          { name: 'chrome', minVersion: 120 },
          { name: 'safari', minVersion: 17 },
          { name: 'firefox', minVersion: 120 },
        ],
        devices: userAgent === 'mobile' ? ['mobile'] : ['desktop'],
        locales: ['ja-JP', 'en-US'],
        operatingSystems:
          userAgent === 'mobile' ? ['android', 'ios'] : ['windows', 'macos'],
        httpVersion: '2',
      },
      proxyUrl: undefined, // Add proxy support if needed
      timeout: {
        request: timeout,
      },
      retry: {
        limit: 2,
        statusCodes: [408, 413, 429, 500, 502, 503, 504, 521, 522, 524],
      },
      http2: true,
      followRedirect: true,
    });

    logInfo(`crawlee fetch success: ${url} (${response.body.length} bytes)`);
    return response.body;
  } catch (error) {
    logWarn(`crawlee fetch failed for ${url}`, error);
    return null;
  }
}

/**
 * Fetch HTML with legacy fetch method
 * Lightweight but may be blocked by bot protection
 */
async function fetchWithLegacyFetch(
  url: string,
  userAgent: UserAgentType = 'mobile'
): Promise<string | null> {
  try {
    logDebug(`Fetching with legacy fetch: ${url}`);
    const html = await legacyFetchHtml(url, userAgent);

    if (html) {
      logInfo(`Legacy fetch success: ${url} (${html.length} bytes)`);
    }

    return html;
  } catch (error) {
    logWarn(`Legacy fetch failed for ${url}`, error);
    return null;
  }
}

/**
 * Smart fetch with automatic fallback strategy
 *
 * @param url - URL to fetch
 * @param options - Fetch options
 * @returns HTML content or null if all strategies fail
 */
export async function smartFetchHtml(
  url: string,
  options: SmartFetchOptions = {}
): Promise<string | null> {
  const {
    strategy = 'crawlee',
    userAgent = 'mobile',
    timeout = 30000,
    maxRetries = 3,
  } = options;

  logInfo(`Smart fetch starting for ${url} with strategy: ${strategy}`);

  // Single strategy mode (no fallback)
  if (strategy === 'fetch') {
    return fetchWithLegacyFetch(url, userAgent);
  }

  // Default: crawlee with fallback
  let html: string | null = null;
  let attempt = 0;

  // Stage 1: Try crawlee
  while (attempt < maxRetries && !html) {
    attempt++;
    logDebug(`crawlee attempt ${attempt}/${maxRetries} for ${url}`);
    html = await fetchWithCrawlee(url, userAgent, timeout);

    if (html) {
      return html;
    }

    // Wait before retry
    if (attempt < maxRetries) {
      const waitTime = attempt * 1000; // 1s, 2s, 3s...
      logDebug(`Waiting ${waitTime}ms before retry...`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }

  // Stage 2: Try legacy fetch as fallback
  logWarn(`crawlee failed after ${maxRetries} attempts, trying legacy fetch...`);
  html = await fetchWithLegacyFetch(url, userAgent);

  if (!html) {
    logError(`All fetch strategies failed for ${url}`);
  }

  return html;
}

/**
 * Fetch HTML with specified strategy (no fallback)
 *
 * @param url - URL to fetch
 * @param strategy - Fetch strategy to use
 * @param userAgent - User agent type
 * @returns HTML content or null if fetch fails
 */
export async function fetchHtmlWithStrategy(
  url: string,
  strategy: FetchStrategy = 'crawlee',
  userAgent: UserAgentType = 'mobile',
  timeout: number = 30000
): Promise<string | null> {
  switch (strategy) {
    case 'crawlee':
      return fetchWithCrawlee(url, userAgent, timeout);
    case 'fetch':
      return fetchWithLegacyFetch(url, userAgent);
    default:
      logError(`Unknown fetch strategy: ${strategy}`);
      return null;
  }
}
