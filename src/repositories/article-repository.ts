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
      const { data, error } = await this.client.from(this.tableName).insert(articles).select('*');

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

/**
 * D1-specific repository for Article data
 */
// export class D1ArticleRepository {
//   private readonly accountId: string;
//   private readonly databaseId: string;
//   private readonly apiToken: string;
//   private readonly apiUrl: string;
//
//   constructor() {
//     const { cloudflareAccountId, d1DatabaseId, cloudflareApiToken } = appConfig;
//
//     if (!cloudflareAccountId || !d1DatabaseId || !cloudflareApiToken) {
//       throw new Error(
//         'Cloudflare D1 credentials are not configured. Please set CLOUDFLARE_ACCOUNT_ID, D1_DATABASE_ID, and CLOUDFLARE_API_TOKEN.'
//       );
//     }
//
//     this.accountId = cloudflareAccountId;
//     this.databaseId = d1DatabaseId;
//     this.apiToken = cloudflareApiToken;
//     this.apiUrl = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/d1/database/${this.databaseId}/query`;
//   }
//
//   /**
//    * Executes a query against the D1 HTTP API.
//    */
//   private async _query<T>(sql: string, params: any[] = []): Promise<{ results: T[], meta: any }> {
//     try {
//       const response = await fetch(this.apiUrl, {
//         method: 'POST',
//         headers: {
//           'Content-Type': 'application/json',
//           Authorization: `Bearer ${this.apiToken}`,
//         },
//         body: JSON.stringify({ sql, params }),
//       });
//
//       if (!response.ok) {
//         const errorText = await response.text();
//         throw new Error(`D1 API request failed with status ${response.status}: ${errorText}`);
//       }
//
//       const data = (await response.json()) as { result?: { results?: T[], meta?: any }[] };
//       return {
//         results: data.result?.[0]?.results ?? [],
//         meta: data.result?.[0]?.meta ?? {},
//       };
//     } catch (error) {
//       logError('Failed to execute D1 query', error);
//       throw error;
//     }
//   }
//
//   /**
//    * Insert many articles into D1.
//    * Note: This implementation strips the 'content' field as it's not stored in the D1 articles table.
//    */
//   async insertMany(articles: Partial<Article>[]): Promise<number> {
//     if (articles.length === 0) return 0;
//
//     const columns = ['site_id', 'title', 'url', 'pub_date', 'thumbnail'];
//     const placeholders = articles.map(() => `(${columns.map(() => '?').join(',')})`).join(',');
//     const sql = `INSERT INTO articles (${columns.join(',')}) VALUES ${placeholders};`;
//
//     const params = articles.flatMap(article => [
//       article.site_id,
//       article.title,
//       article.url,
//       article.pub_date,
//       article.thumbnail,
//     ]);
//
//     try {
//       const { meta } = await this._query(sql, params);
//       return meta.changes ?? 0;
//     } catch (error) {
//       // D1 HTTP API doesn't give structured error codes for duplicates easily,
//       // so we log the generic error.
//       logError('D1: Failed to insert articles', error);
//       return 0;
//     }
//   }
//
//   /**
//    * This method is a no-op for D1, as content is stored in R2.
//    */
//   async updateContent(articleId: number, newContent: string): Promise<boolean> {
//     logWarn(`D1ArticleRepository.updateContent is a no-op. Content for article ${articleId} is not stored in D1.`);
//     return Promise.resolve(true);
//   }
//
//   /**
//    * Get article by ID from D1.
//    */
//   async getById(articleId: number): Promise<Article | null> {
//     const sql = `SELECT * FROM articles WHERE id = ?;`;
//     try {
//       const { results } = await this._query<any>(sql, [articleId]);
//       if (results.length === 0) return null;
//       // D1 articles table has no 'content', so we can parse directly.
//       return ArticleSchema.parse(results[0]);
//     } catch (error) {
//       logError(`D1: Failed to get article by ID ${articleId}`, error);
//       return null;
//     }
//   }
//
//   /**
//    * Delete articles by IDs in batches from D1.
//    */
//   async deleteByIds(ids: number[]): Promise<number> {
//     if (ids.length === 0) return 0;
//
//     // D1's HTTP API is more efficient with a single query with many params
//     // than with the /execute endpoint for many small queries.
//     const placeholders = ids.map(() => '?').join(',');
//     const sql = `DELETE FROM articles WHERE id IN (${placeholders});`;
//
//     try {
//       const { meta } = await this._query(sql, ids);
//       return meta.changes ?? 0;
//     } catch (error) {
//       logError('D1: Failed to delete articles batch', error);
//       return 0;
//     }
//   }
//
//   /**
//    * Check which URLs already exist in the D1 database (batch operation).
//    * Returns a Set of URLs that already exist.
//    */
//   async checkExistingUrls(urls: string[]): Promise<Set<string>> {
//     if (urls.length === 0) return new Set();
//
//     const placeholders = urls.map(() => '?').join(',');
//     const sql = `SELECT url FROM articles WHERE url IN (${placeholders});`;
//
//     try {
//       const { results } = await this._query<{ url: string }>(sql, urls);
//       return new Set(results.map((row) => row.url));
//     } catch (error) {
//       logError(`D1: Failed to batch check existing URLs (${urls.length} URLs)`, error);
//       return new Set();
//     }
//   }
// }
