/**
 * Playwright service for dynamic content rendering
 */

import { chromium, Browser, BrowserContext, devices } from 'playwright';
import { logWarn, logger } from '../utils/logger.js';

export class PlaywrightService {
  public browser: Browser | null = null;

  /**
   * Start the browser
   */
  async start(): Promise<void> {
    if (!this.browser) {
      logger.info('Starting Playwright browser');
      this.browser = await chromium.launch({
        headless: true,
      });
    }
  }

  /**
   * Stop the browser
   */
  async stop(): Promise<void> {
    if (this.browser) {
      logger.info('Stopping Playwright browser');
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * Render Twitter card with dynamic height measurement
   */
  async renderTwitterCard(blockquoteHtml: string, scriptHtml: string): Promise<string | null> {
    if (!this.browser) {
      throw new Error('PlaywrightService has not been started');
    }

    const htmlTemplate = `
      <!DOCTYPE html>
      <html>
        <head><meta charset="utf-8"><title>Twitter Card Renderer</title></head>
        <body>${blockquoteHtml}${scriptHtml}</body>
      </html>
    `;

    let context: BrowserContext | null = null;

    try {
      // Use iPhone device settings
      const device = devices['iPhone 14'];
      context = await this.browser.newContext({
        ...device,
        locale: 'ja-JP',
        timezoneId: 'Asia/Tokyo',
      });

      const page = await context.newPage();
      await page.setContent(htmlTemplate);

      // Wait for Twitter iframe to render
      const renderedIframeSelector = 'iframe[data-tweet-id]';
      await page.waitForSelector(renderedIframeSelector, { timeout: 15000 });

      const iframeHandle = await page.$(renderedIframeSelector);
      if (!iframeHandle) {
        return null;
      }

      const iframeContent = await iframeHandle.contentFrame();
      if (!iframeContent) {
        logWarn('Could not get iframe content frame');
        return null;
      }

      await iframeContent.waitForLoadState();

      // Check if tweet exists (not deleted)
      const articleCount = await iframeContent.locator('article').count();
      if (articleCount === 0) {
        logWarn('Tweet seems to be deleted (no <article> tag found)');
        return null;
      }

      // Measure content height
      const contentHeight = await iframeContent.evaluate(() => {
        return (globalThis as typeof globalThis & { document: { body: { scrollHeight: number } } })
          .document.body.scrollHeight;
      });
      const finalHeight = Math.round((contentHeight || 275) * 1.15);

      // Modify iframe styling and return HTML
      const result = await iframeHandle.evaluate((element, measuredHeight) => {
        const parentDiv = element.parentElement;
        if (parentDiv) {
          parentDiv.style.width = 'auto';
          parentDiv.style.height = 'auto';
          parentDiv.style.maxWidth = '100%';
          parentDiv.style.marginTop = '12px';
        }
        element.style.width = '100%';
        element.style.height = `${measuredHeight}px`;
        element.style.border = 'none';

        return parentDiv ? parentDiv.outerHTML : element.outerHTML;
      }, finalHeight);

      return result;
    } catch (error) {
      logWarn(
        `Failed to render Twitter card: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    } finally {
      if (context) {
        await context.close();
      }
    }
  }
}
