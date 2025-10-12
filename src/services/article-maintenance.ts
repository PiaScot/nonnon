/**
 * Article maintenance service
 */

import { ArticleRepository } from '../repositories/article-repository.js';
import { ArticlesApiClient } from '../repositories/articles-api-client.js';
import { appConfig } from '../utils/config.js';
import { logger, logInfo, logWarn, logSuccess, logError } from '../utils/logger.js';

/**
 * Maintain article limit by removing oldest articles
 * Preserves bookmarked articles
 */
export async function maintainArticleLimit(): Promise<void> {
  logInfo('Starting to check and maintain article limit...');

  try {
    const articleRepo = new ArticleRepository();

    const allCount = await articleRepo.getTotalCount();

    if (allCount <= appConfig.maxArticles) {
      logInfo('The number of articles is within the limit. No cleanup needed.');
      return;
    }

    logInfo(`Article count (${allCount}) exceeds limit (${appConfig.maxArticles}).`);

    const articlesToDeleteCount = allCount - appConfig.maxArticles;

    const staleArticleIds = await articleRepo.fetchOldestIds(articlesToDeleteCount);

    if (staleArticleIds.length === 0) {
      logInfo('No un-bookmarked old articles found to delete.');
      return;
    }

    logInfo(`Found ${staleArticleIds.length} stale articles to delete.`);

    // Step 1: Delete from Supabase
    const deleteCount = await articleRepo.deleteByIds(staleArticleIds);

    if (deleteCount > 0) {
      logSuccess(`Successfully deleted ${deleteCount} articles from Supabase.`);
    } else {
      logWarn(`Failed to delete article IDs from Supabase: ${staleArticleIds.join(', ')}`);
      return;
    }

    // Step 2: Delete from R2 (if articles-api is configured)
    if (!appConfig.articlesApiUrl || !appConfig.articlesApiSecret) {
      logInfo('articles-api not configured, skipping R2 deletion');
      return;
    }

    const articlesApiClient = new ArticlesApiClient();
    logInfo(`Deleting ${staleArticleIds.length} article contents from R2...`);

    const r2DeletePromises = staleArticleIds.map((articleId) =>
      articlesApiClient.deleteArticleContent(articleId)
    );

    const r2Results = await Promise.allSettled(r2DeletePromises);
    const r2SuccessCount = r2Results.filter(
      (r) => r.status === 'fulfilled' && r.value === true
    ).length;

    logSuccess(`Successfully deleted ${r2SuccessCount}/${staleArticleIds.length} contents from R2.`);

    const r2FailedCount = staleArticleIds.length - r2SuccessCount;
    if (r2FailedCount > 0) {
      logError(`${r2FailedCount} content deletions from R2 failed.`);
    }
  } catch (error) {
    logger.error({ err: error }, 'Error in maintain_article_limit');
    throw error;
  }
}
