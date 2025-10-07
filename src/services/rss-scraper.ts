/**
 * RSS scraper service
 */

import Parser from 'rss-parser';
import { Site, Article } from '../models/schemas.js';
import { ArticleRepository } from '../repositories/article-repository.js';
import { smartFetchHtml } from '../utils/smart-http-client.js';
import { processArticleHtml } from './html-processor.js';
import { logInfo, logWarn, logError } from '../utils/logger.js';
import * as cheerio from 'cheerio';

const rssParser = new Parser({
  timeout: 30000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    Accept: 'application/rss+xml,application/xml,application/atom+xml,text/xml,*/*',
    'Accept-Language': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cache-Control': 'no-cache',
  },
  customFields: {
    item: [
      ['media:thumbnail', 'media:thumbnail'],
      ['media:content', 'media:content'],
    ],
  },
});

/**
 * Scrape a single site
 */
export async function scrapeSite(
  site: Site,
  generalRemoveTags: string[],
  allowedHosts: Set<string>,
  articleRepo: ArticleRepository
): Promise<{ insertedCount: number; totalArticles: number }> {
  if (!site.rss || !site.domain) {
    logWarn(`[SKIP] RSS or Domain not registered for siteId=${site.id}`);
    return { insertedCount: 0, totalArticles: 0 };
  }

  const feed = await fetchRssFeed(site.rss);
  if (!feed || !feed.items) {
    return { insertedCount: 0, totalArticles: 0 };
  }

  // Extract all URLs from feed
  const feedUrls = feed.items
    .map((item) => item.link?.split('?')[0].trim())
    .filter((url): url is string => !!url);

  if (feedUrls.length === 0) {
    logInfo(`No valid URLs found in RSS feed for site: ${site.title}`);
    return { insertedCount: 0, totalArticles: 0 };
  }

  // Batch check existing URLs
  const existingUrls = await articleRepo.checkExistingUrls(feedUrls);
  logInfo(`Found ${existingUrls.size} existing articles out of ${feedUrls.length} in feed`);

  const articlesToInsert: Partial<Article>[] = [];

  for (const item of feed.items) {
    const link = item.link?.split('?')[0].trim();
    if (!link) continue;

    // Skip if already exists (from batch check)
    if (existingUrls.has(link)) {
      logInfo(`Article already exists, skipping. URL: ${link}`);
      continue;
    }

    const article = await processSingleArticle(
      item,
      link,
      site,
      generalRemoveTags,
      allowedHosts
    );

    if (article) {
      articlesToInsert.push({
        site_id: article.site_id,
        title: article.title,
        url: article.url,
        content: article.content,
        pub_date: article.pub_date,
        thumbnail: article.thumbnail,
      });
    }
  }

  if (articlesToInsert.length === 0) {
    logInfo(`No new articles to insert for site: ${site.title}`);
    return { insertedCount: 0, totalArticles: feed.items.length };
  }

  const count = await articleRepo.insertMany(articlesToInsert);
  return { insertedCount: count, totalArticles: feed.items.length };
}

/**
 * Fetch RSS feed
 */
export async function fetchRssFeed(rssUrl: string): Promise<Parser.Output<unknown> | null> {
  try {
    // Try direct parsing first
    const feed = await rssParser.parseURL(rssUrl);
    return feed;
  } catch (error) {
    logWarn(`Direct RSS fetch failed for ${rssUrl}, trying with crawlee...`, error);

    // Fallback: Use crawlee to fetch RSS XML
    try {
      const xml = await smartFetchHtml(rssUrl, { strategy: 'crawlee', timeout: 30000 });
      if (!xml) {
        logError(`Failed to fetch RSS XML via crawlee: ${rssUrl}`);
        return null;
      }

      const feed = await rssParser.parseString(xml);
      logInfo(`Successfully fetched RSS via crawlee: ${rssUrl}`);
      return feed;
    } catch (fallbackError) {
      logError(`Failed to fetch RSS (all methods): ${rssUrl}`, fallbackError);
      return null;
    }
  }
}

/**
 * Process a single article from RSS feed
 */
export async function processSingleArticle(
  item: Parser.Item,
  link: string,
  site: Site,
  generalRemoveTags: string[],
  allowedHosts: Set<string>
): Promise<Article | null> {
  // Get fetch strategy from site options, default to 'crawlee'
  const fetchStrategy = 'crawlee';

  const mobileHtml = await smartFetchHtml(link, {
    strategy: fetchStrategy,
    userAgent: 'mobile',
    timeout: 30000,
    maxRetries: 3,
  });

  if (!mobileHtml) {
    return null;
  }

  const removeSelectorTags = site.scrape_options?.remove_selector_tags || [];
  const finalRemoveSelectors = Array.from(new Set([...generalRemoveTags, ...removeSelectorTags]));

  const content = await processArticleHtml(
    mobileHtml,
    link,
    finalRemoveSelectors,
    allowedHosts
  );

  if (!content) {
    logError(`Failed to extract content for: ${link}`);
    return null;
  }

  const $ = cheerio.load(content);
  const thumbnail = findThumbnail($, link, site.domain || '');
  const pubDate = getPublicationDate(item);
  const title = item.title || `No Title Found for ${link}`;

  return {
    site_id: site.id,
    title,
    url: link,
    category: site.category,
    content,
    pub_date: pubDate,
    thumbnail,
  };
}

/**
 * Find thumbnail from article content
 * Priority: Same domain + no "logo" + https > Same domain + no "logo" + http > First image
 */
export function findThumbnail($: cheerio.CheerioAPI, pageUrl: string, domain: string): string {
  // Find images from the same domain, excluding logos
  const images = $('img.my-formatted:not([src^="data:"])').toArray();
  const candidates: string[] = [];

  for (const img of images) {
    const src = $(img).attr('src');
    if (src) {
      const absoluteSrc = new URL(src, pageUrl).href;
      if (absoluteSrc.includes(domain) && !absoluteSrc.toLowerCase().includes('logo')) {
        candidates.push(absoluteSrc);
      }
    }
  }

  // Prioritize https URLs
  if (candidates.length > 0) {
    const httpsCandidate = candidates.find((url) => url.startsWith('https://'));
    if (httpsCandidate) {
      return httpsCandidate;
    }
    // Fallback to first candidate (http or other)
    return candidates[0];
  }

  // Fallback to first image
  const firstImg = $('img.my-formatted:not([src^="data:"])').first();
  const src = firstImg.attr('src');
  if (src) {
    return new URL(src, pageUrl).href;
  }

  return '';
}

/**
 * Get publication date from RSS item
 */
export function getPublicationDate(item: Parser.Item): string {
  if (item.isoDate) {
    return item.isoDate;
  }

  if (item.pubDate) {
    try {
      return new Date(item.pubDate).toISOString();
    } catch {
      // Fall through
    }
  }

  return new Date().toISOString();
}
