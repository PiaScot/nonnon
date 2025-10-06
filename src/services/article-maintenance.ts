/**
 * Article maintenance service
 */

import { ArticleRepository } from '../repositories/article-repository.js';
import { BookmarkRepository } from '../repositories/bookmark-repository.js';
import { appConfig } from '../utils/config.js';
import { logger, logInfo, logWarn } from '../utils/logger.js';

/**
 * Maintain article limit by removing oldest articles
 * Preserves bookmarked articles
 */
export async function maintainArticleLimit(): Promise<void> {
  logInfo('Starting to check and maintain article limit...');

  try {
    const articleRepo = new ArticleRepository();
    const bookmarkRepo = new BookmarkRepository();

    const allCount = await articleRepo.getTotalCount();

    if (allCount <= appConfig.maxArticles) {
      logInfo('The number of articles is within the limit. No cleanup needed.');
      return;
    }

    logInfo(`Article count (${allCount}) exceeds limit (${appConfig.maxArticles}).`);

    const articlesToDeleteCount = allCount - appConfig.maxArticles;
    const bookmarkedIds = await bookmarkRepo.getBookmarkedIds();

    logInfo(`Found ${bookmarkedIds.size} bookmarked articles to exclude.`);
    logInfo(`Need to delete ${articlesToDeleteCount} articles.`);

    const staleArticleIds = await articleRepo.fetchOldestIds(articlesToDeleteCount, bookmarkedIds);

    if (staleArticleIds.length === 0) {
      logInfo('No un-bookmarked old articles found to delete.');
      return;
    }

    logInfo(`Found ${staleArticleIds.length} stale articles to delete.`);
    const deleteCount = await articleRepo.deleteByIds(staleArticleIds);

    if (deleteCount > 0) {
      logInfo(`Successfully deleted ${deleteCount} articles.`);
    } else {
      logWarn(`Failed to delete article IDs: ${staleArticleIds.join(', ')}`);
    }
  } catch (error) {
    logger.error({ err: error }, 'Error in maintain_article_limit');
    throw error;
  }
}
