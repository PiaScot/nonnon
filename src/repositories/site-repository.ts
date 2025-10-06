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
