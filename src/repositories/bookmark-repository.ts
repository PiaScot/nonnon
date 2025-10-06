/**
 * Bookmark repository for database operations
 */

import { BaseRepository } from './base-repository.js';
import { Article, ArticleSchema } from '../models/schemas.js';
import { appConfig } from '../utils/config.js';
import { logError } from '../utils/logger.js';
import { z } from 'zod';

export class BookmarkRepository extends BaseRepository {
  constructor() {
    super(appConfig.bookmarkTable);
  }

  /**
   * Get bookmarked article IDs
   */
  async getBookmarkedIds(): Promise<Set<number>> {
    try {
      const { data, error } = await this.client.from(this.tableName).select('id');

      if (error) throw error;
      if (!data) return new Set();

      return new Set(data.map((item) => item.id));
    } catch (error) {
      logError('Failed to get bookmarked IDs', error);
      return new Set();
    }
  }

  /**
   * Get all bookmarked articles
   */
  async getBookmarkedArticles(): Promise<Article[]> {
    try {
      const { data, error } = await this.client.from(this.tableName).select('*');

      if (error) throw error;
      if (!data) return [];

      return z.array(ArticleSchema).parse(data);
    } catch (error) {
      logError('Failed to get bookmarked articles', error);
      return [];
    }
  }

  /**
   * Get bookmarked articles by site ID
   */
  async getBookmarkedArticlesBySite(siteId: number): Promise<Article[]> {
    try {
      const { data, error } = await this.client
        .from(this.tableName)
        .select('*')
        .eq('site_id', siteId);

      if (error) throw error;
      if (!data) return [];

      return z.array(ArticleSchema).parse(data);
    } catch (error) {
      logError(`Failed to get bookmarked articles for site ${siteId}`, error);
      return [];
    }
  }
}
