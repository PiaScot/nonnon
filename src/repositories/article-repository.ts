/**
 * Article repository for database operations
 */

import { BaseRepository } from './base-repository.ts';
import { Article, ArticleSchema } from '../models/schemas.ts';
import { appConfig } from '../utils/config.ts';
import { logger, logError } from '../utils/logger.ts';
import { z } from 'zod';

export class ArticleRepository extends BaseRepository {
  constructor() {
    super(appConfig.articleTable);
  }

  /**
   * Get total count of articles
   */
  async getTotalCount(): Promise<number> {
    try {
      const { count, error } = await this.client
        .from(this.tableName)
        .select('id', { count: 'exact', head: true });

      if (error) throw error;
      return count ?? 0;
    } catch (error) {
      logError('Failed to get total article count', error);
      return 0;
    }
  }

  /**
   * Update article content
   */
  async updateContent(articleId: number, newContent: string): Promise<boolean> {
    try {
      const { error } = await this.client
        .from(this.tableName)
        .update({ content: newContent })
        .eq('id', articleId);

      if (error) throw error;
      return true;
    } catch (error) {
      logError(`Failed to update content for article ${articleId}`, error);
      return false;
    }
  }

  /**
   * Get article by ID
   */
  async getById(articleId: number): Promise<Article | null> {
    try {
      const { data, error } = await this.client
        .from(this.tableName)
        .select('*')
        .eq('id', articleId)
        .single();

      if (error) throw error;
      if (!data) return null;

      return ArticleSchema.parse(data);
    } catch (error) {
      logError(`Failed to get article by ID ${articleId}`, error);
      return null;
    }
  }

  /**
   * Get latest N articles
   */
  async getLatest(n: number): Promise<Article[]> {
    try {
      const { data, error } = await this.client
        .from(this.tableName)
        .select('*')
        .order('pub_date', { ascending: false })
        .limit(n);

      if (error) throw error;
      if (!data) return [];

      return z.array(ArticleSchema).parse(data);
    } catch (error) {
      logError(`Failed to get latest ${n} articles`, error);
      return [];
    }
  }

  /**
   * Fetch oldest article IDs excluding specified IDs
   */
  async fetchOldestIds(limit: number, excludeIds: Set<number> = new Set()): Promise<number[]> {
    try {
      let query = this.client
        .from(this.tableName)
        .select('id')
        .order('created_at', { ascending: true })
        .limit(limit);

      if (excludeIds.size > 0) {
        query = query.not('id', 'in', `(${Array.from(excludeIds).join(',')})`);
      }

      const { data, error } = await query;

      if (error) throw error;
      if (!data) return [];

      return data.map((item) => item.id);
    } catch (error) {
      logError('Failed to fetch oldest article IDs', error);
      return [];
    }
  }

  /**
   * Delete articles by IDs in batches
   */
  async deleteByIds(ids: number[]): Promise<number> {
    if (ids.length === 0) return 0;

    let totalDeleted = 0;

    try {
      // Process in batches
      for (let i = 0; i < ids.length; i += appConfig.batchSize) {
        const batch = ids.slice(i, i + appConfig.batchSize);

        const { data, error } = await this.client
          .from(this.tableName)
          .delete()
          .in('id', batch)
          .select('id');

        if (error) throw error;
        totalDeleted += data?.length ?? 0;
      }

      return totalDeleted;
    } catch (error) {
      logError('Failed to delete articles batch', error);
      return totalDeleted;
    }
  }

  /**
   * Insert many articles
   */
  async insertMany(articles: Partial<Article>[]): Promise<Article[]> {
    if (articles.length === 0) return [];

    try {
      const sanitizedArticles = articles.map(({ content, ...rest }) => rest);
      const { data, error } = await this.client.from(this.tableName).insert(sanitizedArticles).select('*');

      if (error) {
        // Handle duplicate key error
        if (error.code === '23505') {
          logger.warn('Skipped inserting duplicate articles');
          return [];
        }
        throw error;
      }

      return data ?? [];
    } catch (error) {
      logError('Failed to insert articles', error);
      throw error;
    }
  }

  /**
   * Check if article exists by URL
   */
  async checkExistsByUrl(url: string): Promise<boolean> {
    try {
      const { count, error } = await this.client
        .from(this.tableName)
        .select('id', { count: 'exact', head: true })
        .eq('url', url)
        .limit(1);

      if (error) throw error;
      return (count ?? 0) > 0;
    } catch (error) {
      logError(`Failed to check article existence by URL: ${url}`, error);
      return false;
    }
  }

  /**
   * Check which URLs already exist in the database (batch operation)
   * Returns a Set of URLs that already exist
   */
  async checkExistingUrls(urls: string[]): Promise<Set<string>> {
    if (urls.length === 0) return new Set();

    try {
      const { data, error } = await this.client
        .from(this.tableName)
        .select('url')
        .in('url', urls);

      if (error) throw error;
      if (!data) return new Set();

      return new Set(data.map((row) => row.url));
    } catch (error) {
      logError(`Failed to batch check existing URLs (${urls.length} URLs)`, error);
      return new Set();
    }
  }

  /**
   * Get random articles by site ID
   */
  async getRandomBySiteId(siteId: number, limit: number = 3): Promise<Article[]> {
    try {
      // Fetch more than needed and shuffle client-side
      // Supabase doesn't have native RANDOM() for large tables efficiently
      const { data, error } = await this.client
        .from(this.tableName)
        .select('*')
        .eq('site_id', siteId)
        .limit(100);

      if (error) throw error;
      if (!data || data.length === 0) return [];

      // Shuffle and take requested amount
      const shuffled = data.sort(() => Math.random() - 0.5);
      const selected = shuffled.slice(0, limit);

      return z.array(ArticleSchema).parse(selected);
    } catch (error) {
      logError(`Failed to get random articles for site ${siteId}`, error);
      return [];
    }
  }

  /**
   * Get latest articles by site ID
   */
  async getLatestBySiteId(siteId: number, n: number): Promise<Article[]> {
    try {
      const { data, error } = await this.client
        .from(this.tableName)
        .select('*')
        .eq('site_id', siteId)
        .order('pub_date', { ascending: false })
        .limit(n);

      if (error) throw error;
      if (!data) return [];

      return z.array(ArticleSchema).parse(data);
    } catch (error) {
      logError(`Failed to get latest articles for site ${siteId}`, error);
      return [];
    }
  }
}
