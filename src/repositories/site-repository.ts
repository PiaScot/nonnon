/**
 * Site repository for database operations
 */

import { BaseRepository } from './base-repository.ts';
import { Site, SiteSchema } from '../models/schemas.ts';
import { appConfig } from '../utils/config.ts';
import { logError, logger, logSuccess } from '../utils/logger.ts';
import { z } from 'zod';

export class SiteRepository extends BaseRepository {
  constructor() {
    super(appConfig.siteTable);
  }

  /**
   * Update last access timestamp for a site
   */
  async updateLastAccess(siteId: number): Promise<void> {
    try {
      const { error } = await this.client
        .from(this.tableName)
        .update({ last_access: new Date().toISOString() })
        .eq('id', siteId);

      if (error) throw error;
    } catch (error) {
      logError(`Failed to update last access for site ${siteId}`, error);
    }
  }

  /**
   * Get site by ID
   */
  async getById(siteId: number): Promise<Site | null> {
    try {
      const { data, error } = await this.client
        .from(this.tableName)
        .select('*')
        .eq('id', siteId)
        .single();

      if (error) throw error;
      if (!data) return null;

      return SiteSchema.parse(data);
    } catch (error) {
      logError(`Failed to get site by ID ${siteId}`, error);
      return null;
    }
  }

  /**
   * Get all sites
   */
  async getAll(): Promise<Site[]> {
    try {
      const { data, error } = await this.client
        .from(this.tableName)
        .select('*')
        .order('id', { ascending: true });

      if (error) throw error;
      if (!data) return [];

      return z.array(SiteSchema).parse(data);
    } catch (error) {
      logError('Failed to get all sites', error);
      return [];
    }
  }

  /**
   * Get site by URL (matches by domain)
   */
  async getByUrl(url: string): Promise<Site | null> {
    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname;

      const { data, error } = await this.client
        .from(this.tableName)
        .select('*')
        .eq('domain', domain)
        .single();

      if (error) throw error;
      if (!data) return null;

      return SiteSchema.parse(data);
    } catch (error) {
      logError(`Failed to get site by URL ${url}`, error);
      return null;
    }
  }

  /**
   * Get sites to scrape using RPC function
   */
  async getSitesToScrape(): Promise<Site[]> {
    try {
      const { data, error } = await this.client.rpc(appConfig.getSitesToScrapeRpc);

      if (error) throw error;
      if (!data) return [];

      return z.array(SiteSchema).parse(data);
    } catch (error) {
      logError('Failed to get sites to scrape', error);
      return [];
    }
  }

  /**
   * Assign user ID to sites where user_id is NULL
   */
  async assignUserIdToNullSites(userId: string): Promise<number> {
    try {
      logger.info(`Assigning user_id '${userId}' to all sites where user_id is NULL...`);

      const { data, error } = await this.client
        .from(this.tableName)
        .update({ user_id: userId })
        .is('user_id', null)
        .select('id');

      if (error) throw error;
      if (!data) return 0;

      const count = data.length;
      logSuccess(`Successfully updated ${count} sites.`);
      return count;
    } catch (error) {
      logError('Failed to assign user ID to null sites', error);
      return 0;
    }
  }
}

/**
 * D1-specific repository for Site data
 */
export class D1SiteRepository {
  private readonly accountId: string;
  private readonly databaseId: string;
  private readonly apiToken: string;
  private readonly apiUrl: string;

  constructor() {
    const { cloudflareAccountId, d1DatabaseId, cloudflareApiToken } = appConfig;

    if (!cloudflareAccountId || !d1DatabaseId || !cloudflareApiToken) {
      throw new Error(
        'Cloudflare D1 credentials are not configured. Please set CLOUDFLARE_ACCOUNT_ID, D1_DATABASE_ID, and CLOUDFLARE_API_TOKEN.'
      );
    }

    this.accountId = cloudflareAccountId;
    this.databaseId = d1DatabaseId;
    this.apiToken = cloudflareApiToken;
    this.apiUrl = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/d1/database/${this.databaseId}/query`;
  }

  /**
   * Executes a query against the D1 HTTP API.
   * @param sql The SQL query string.
   * @param params Optional query parameters.
   * @returns The raw results from the D1 API.
   */
  private async _query<T>(sql: string, params: any[] = []): Promise<T[]> {
    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiToken}`,
        },
        body: JSON.stringify({ sql, params }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`D1 API request failed with status ${response.status}: ${errorText}`);
      }

      const data = (await response.json()) as { result?: { results?: T[] }[] };
      return data.result?.[0]?.results ?? [];
    } catch (error) {
      logError('Failed to execute D1 query', error);
      throw error;
    }
  }

  /**
   * Fetches sites that are due for scraping.
   * This is the D1 equivalent of the get_sites_to_scrape() PostgreSQL function.
   */
  async getSitesToScrape(): Promise<Site[]> {
    // This query assumes the `last_access` column has been cleaned to 'YYYY-MM-DDTHH:MM:SSZ' format.
    const sql = `
      SELECT *
      FROM sites
      WHERE (strftime('%s', 'now') - strftime('%s', last_access)) >= scrape_interval_seconds;
    `;

    try {
      const results = await this._query<any>(sql);
      // Use Zod to parse and validate the data, ensuring type safety
      return z.array(SiteSchema).parse(results);
    } catch (error) {
      logError('D1: Failed to get sites to scrape', error);
      return [];
    }
  }
}
