/**
 * HTTP client utilities
 */

import { appConfig } from './config.js';
import { logError, logWarn } from './logger.js';

/**
 * Get random PC user agent
 */
export function randomPcUserAgent(): string {
  const agents = appConfig.pcUserAgents;
  return agents[Math.floor(Math.random() * agents.length)];
}

/**
 * Get random mobile user agent
 */
export function randomMobileUserAgent(): string {
  const agents = appConfig.mobileUserAgents;
  return agents[Math.floor(Math.random() * agents.length)];
}

/**
 * Fetch HTML content with user agent
 */
export async function fetchHtml(
  url: string,
  userAgentType: 'mobile' | 'pc' = 'mobile'
): Promise<string> {
  const userAgent = userAgentType === 'mobile' ? randomMobileUserAgent() : randomPcUserAgent();

  const headers = {
    'User-Agent': userAgent,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'ja-JP,ja;q=0.9',
  };

  try {
    const response = await fetch(url, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(20000), // 20 second timeout
    });

    if (!response.ok) {
      logWarn(`HTTP ${response.status} for URL: ${url}`);
      return '';
    }

    let text = await response.text();

    // Remove duplicate empty lines
    text = text.replace(/\n\s*\n+/g, '\n');

    return text;
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        logError(`Request timeout for URL: ${url}`, error);
      } else {
        logError(`Request failed for URL: ${url}`, error);
      }
    }
    return '';
  }
}
