/**
 * Main orchestration for the scraping process
 */

import { scrapeSite } from './services/rss-scraper.ts';
import { maintainArticleLimit } from './services/article-maintenance.ts';
import { ArticleRepository, ConfigRepository, SiteRepository } from './repositories/index.ts';
import { Site } from './models/schemas.ts';
import { logError, logger, logInfo, logSuccess } from './utils/logger.ts';
import { Semaphore } from './utils/concurrency.ts';
import { appConfig } from './utils/config.ts';

interface ScrapingContext {
  sitesToScrape: Site[];
  generalRemoveTags: string[];
  allowedHosts: Set<string>;
}

/**
 * Prepare scraping context by loading necessary data from database
 */
export async function prepare(
  siteRepo: SiteRepository,
  configRepo: ConfigRepository
): Promise<ScrapingContext | null> {
  logInfo('Preparing data for scraping...');

  const allowedHosts = await configRepo.getAllowedHosts();
  logInfo(`Loaded ${allowedHosts.size} allowed hosts.`);

  const generalRemoveTags = await configRepo.getGeneralRemoveTags();
  logInfo(`Loaded ${generalRemoveTags.length} general remove tags.`);

  const sitesToScrape = await siteRepo.getSitesToScrape();
  if (sitesToScrape.length === 0) {
    logInfo('No sites to scrape at this time.');
    return null;
  }

  logInfo(`Found ${sitesToScrape.length} sites to scrape.`);
  return {
    sitesToScrape,
    generalRemoveTags,
    allowedHosts,
  };
}

/**
 * Scrape a single site and update its last access timestamp
 */
async function scrapeSiteAndUpdateTimestamp(
  site: Site,
  generalTags: string[],
  allowedHosts: Set<string>,
  articleRepo: ArticleRepository,
  siteRepo: SiteRepository
): Promise<number> {
  try {
    const { insertedCount, totalArticles } = await scrapeSite(
      site,
      generalTags,
      allowedHosts,
      articleRepo
    );

    if (insertedCount >= 0) {
      logInfo(
        `${site.id} ${site.title}: Inserted data(${insertedCount}) got articles(${totalArticles})`
      );
      await siteRepo.updateLastAccess(site.id);
      logSuccess(
        `Successfully scraped and updated timestamp for site ID: ${site.id} (${site.title})`
      );
    } else {
      logInfo('No data to insert to table');
    }

    return site.id;
  } catch (error) {
    logError(`Failed to process site ${site.id} (${site.title})`, error);
    throw error;
  }
}

/**
 * Log scraping results summary
 */
function logScrapingResults(results: Array<number | Error>, sites: Site[]): void {
  logInfo('--- Scraping Results ---');

  const successIds = new Set(results.filter((r): r is number => typeof r === 'number'));
  const successfulSites = sites
    .filter((s) => successIds.has(s.id) && s.title)
    .map((s) => s.title)
    .filter((t): t is string => t !== null);

  const failureCount = sites.length - successIds.size;

  let successMsg = `✅ Success (${successIds.size})`;
  if (successfulSites.length > 0) {
    successMsg += `: ${successfulSites.join(', ')}`;
  }
  logInfo(successMsg);

  if (failureCount > 0) {
    const failedSitesMap = sites
      .filter((s) => !successIds.has(s.id))
      .map((s) => s.title || `(ID:${s.id})`);

    logError(`❌ Failure (${failureCount}):`);
    logError(`  Failed sites: ${failedSitesMap.join(', ')}`);

    logError('--- Failure Details ---');
    results.forEach((result, i) => {
      if (result instanceof Error) {
        const site = sites[i];
        const siteIdentifier = site.title || `ID:${site.id}`;
        logger.error({ err: result }, `  - Exception occurred for site: '${siteIdentifier}'`);
      }
    });
    logError('-----------------------');
  }

  logInfo('------------------------');
  logInfo(`✨ Process summary. Success: ${successIds.size}, Failure: ${failureCount}.`);
}

/**
 * Main scraping process
 */
export async function run(): Promise<void> {
  logInfo('🚀 Starting scraping process...');

  const articleRepo = new ArticleRepository();
  const siteRepo = new SiteRepository();
  const configRepo = new ConfigRepository();

  try {
    const context = await prepare(siteRepo, configRepo);
    if (context === null) {
      return;
    }

    const { sitesToScrape, generalRemoveTags, allowedHosts } = context;

    logInfo(
      `Found ${sitesToScrape.length} sites to scrape. Processing with concurrency limit: ${appConfig.scrapeConcurrency}`
    );

    // Process sites with concurrency limit
    const semaphore = new Semaphore(appConfig.scrapeConcurrency);
    const tasks = sitesToScrape.map((site) =>
      semaphore
        .execute(() =>
          scrapeSiteAndUpdateTimestamp(site, generalRemoveTags, allowedHosts, articleRepo, siteRepo)
        )
        .catch((error) => error)
    );

    const results = await Promise.all(tasks);
    logScrapingResults(results, sitesToScrape);

    // Maintain article limit
    await maintainArticleLimit();
  } catch (error) {
    logger.fatal({ err: error }, '❌ Fatal error in run');
    throw error;
  } finally {
    logInfo('🔚 Scraping process finished.');
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((error) => {
    logger.fatal({ err: error }, 'Unhandled error in main process');
    process.exit(1);
  });
}
