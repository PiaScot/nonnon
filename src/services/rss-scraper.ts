/**
 * RSS scraper service
 */

import Parser from 'rss-parser';
import { Site, Article } from '../models/schemas.js';
import { ArticleRepository } from '../repositories/article-repository.js';
import { ArticlesApiClient } from '../repositories/articles-api-client.js';
import { smartFetchHtml } from '../utils/smart-http-client.js';
import { processArticleHtml } from './html-processor.js';
import { logInfo, logWarn, logError, logSuccess } from '../utils/logger.js';
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
  articleRepo: ArticleRepository // This is the Supabase repository
): Promise<{ insertedCount: number; totalArticles: number }> {
  if (!site.rss || !site.domain) {
    logWarn(`[SKIP] RSS or Domain not registered for siteId=${site.id}`);
    return { insertedCount: 0, totalArticles: 0 };
  }

  const feed = await fetchRssFeed(site.rss);
  if (!feed || !feed.items) {
    return { insertedCount: 0, totalArticles: 0 };
  }

  const feedUrls = feed.items
    .map((item) => item.link?.split('?')[0].trim())
    .filter((url): url is string => !!url);

  if (feedUrls.length === 0) {
    logInfo(`No valid URLs found in RSS feed for site: ${site.title}`);
    return { insertedCount: 0, totalArticles: 0 };
  }

  const existingUrls = await articleRepo.checkExistingUrls(feedUrls);
  logInfo(`Found ${existingUrls.size} existing articles out of ${feedUrls.length} in feed`);

  const articlesToProcess: Partial<Article>[] = [];
  for (const item of feed.items) {
    const link = item.link?.split('?')[0].trim();
    if (!link || existingUrls.has(link)) {
      continue;
    }

    const article = await processSingleArticle(item, link, site, generalRemoveTags, allowedHosts);
    if (article) {
      articlesToProcess.push(article);
    }
  }

  if (articlesToProcess.length === 0) {
    logInfo(`No new articles to insert for site: ${site.title}`);
    return { insertedCount: 0, totalArticles: feed.items.length };
  }

  const articlesToInsert = articlesToProcess.map(({ content, ...rest }) => rest);
  const contentsMap = new Map(
    articlesToProcess.map((a) => [a.url, a.content])
  );

  const newSupabaseArticles = await articleRepo.insertMany(articlesToInsert);
  logSuccess(`Successfully inserted ${newSupabaseArticles.length} articles into Supabase.`);

  if (newSupabaseArticles.length === 0) {
    return { insertedCount: 0, totalArticles: feed.items.length };
  }

  const articlesApiClient = new ArticlesApiClient();
  logInfo(`Uploading ${newSupabaseArticles.length} article contents to R2...`);

  const r2UploadPromises = newSupabaseArticles.map(async (article) => {
    const content = contentsMap.get(article.url);
    if (article.id && content) {
      return articlesApiClient.saveArticleContent(article.id, content);
    }
    return false;
  });

  const r2Results = await Promise.allSettled(r2UploadPromises);
  const r2SuccessCount = r2Results.filter(
    (r) => r.status === 'fulfilled' && r.value === true
  ).length;
  logSuccess(`Successfully uploaded ${r2SuccessCount}/${newSupabaseArticles.length} contents to R2.`);

  const r2FailedCount = newSupabaseArticles.length - r2SuccessCount;
  if (r2FailedCount > 0) {
    logError(`${r2FailedCount} content uploads to R2 failed.`);
  }

  return { insertedCount: newSupabaseArticles.length, totalArticles: feed.items.length };
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
  const thumbnail = findThumbnail($, link);
  const pubDate = getPublicationDate(item);
  const title = item.title || `No Title Found for ${link}`;

  return {
    site_id: site.id,
    title,
    url: link,
    content,
    pub_date: pubDate,
    thumbnail,
  };
}

/**
 * Find thumbnail from article content
 * Priority: Same domain + no "logo" + https > Same domain + no "logo" + http > First image
 */
// export function findThumbnail($: cheerio.CheerioAPI, pageUrl: string, domain: string): string {
//   // Find images from the same domain, excluding logos
//   const images = $('img.my-formatted:not([src^="data:"])').toArray();
//   const candidates: string[] = [];
//
//   for (const img of images) {
//     const src = $(img).attr('src');
//     if (src) {
//       const absoluteSrc = new URL(src, pageUrl).href;
//       if (absoluteSrc.includes(domain) && !absoluteSrc.toLowerCase().includes('logo')) {
//         candidates.push(absoluteSrc);
//       }
//     }
//   }
//
//   // Prioritize https URLs
//   if (candidates.length > 0) {
//     const httpsCandidate = candidates.find((url) => url.startsWith('https://'));
//     if (httpsCandidate) {
//       return httpsCandidate;
//     }
//     // Fallback to first candidate (http or other)
//     return candidates[0];
//   }
//
//   // Fallback to first image
//   const firstImg = $('img.my-formatted:not([src^="data:"])').first();
//   const src = firstImg.attr('src');
//   if (src) {
//     return new URL(src, pageUrl).href;
//   }
//
//   return '';
// }

function findThumbnail($: cheerio.CheerioAPI, pageUrl: string): string {
  const images = $('img').toArray();
  const candidates: string[] = [];

  for (const img of images) {
    const src = $(img).attr('src');
    if (!src) continue;

    // Filter out logos, icons, and other non-content images
    const lowerSrc = src.toLowerCase();
    if (
      lowerSrc.includes('logo') ||
      lowerSrc.includes('icon') ||
      lowerSrc.includes('video.twimg.com/amplify_video') ||
      lowerSrc.startsWith('data:')
    ) {
      continue;
    }

    try {
      // Resolve to absolute URL and add to candidates
      const absoluteSrc = new URL(src, pageUrl).href;
      candidates.push(absoluteSrc);
    } catch (e) {
      console.warn(`[WARN] Invalid image src found: "${src}" on page ${pageUrl}`);
    }
  }

  if (candidates.length === 0) {
    return '';
  }

  // A simple heuristic: prefer images that appear later in the document,
  // but not the very last one, as it might be a tracking pixel.
  if (candidates.length > 2) {
    return candidates[candidates.length - 2];
  }
  return candidates[candidates.length - 1];
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
