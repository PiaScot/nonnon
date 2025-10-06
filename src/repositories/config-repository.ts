/**
 * Config repository for fetching app configuration from database
 */

import { getSupabaseClient } from './supabase-client.js';
import { appConfig } from '../utils/config.js';
import { logError } from '../utils/logger.js';

/**
 * Repository for fetching allowed hosts and general remove tags
 */
export class ConfigRepository {
  private allowHostTable: string;
  private generalRemoveTagsTable: string;

  constructor() {
    this.allowHostTable = appConfig.allowHostTable;
    this.generalRemoveTagsTable = appConfig.generalRemoveTagsTable;
  }

  /**
   * Get allowed embed hosts from database
   */
  async getAllowedHosts(): Promise<Set<string>> {
    try {
      const client = getSupabaseClient();
      const { data, error } = await client.from(this.allowHostTable).select('hostname');

      if (error) throw error;
      if (!data) return new Set();

      return new Set(data.map((row: { hostname: string }) => row.hostname));
    } catch (error) {
      logError('Failed to get allowed hosts', error);
      return new Set();
    }
  }

  /**
   * Get general remove tags (CSS selectors) from database
   */
  async getGeneralRemoveTags(): Promise<string[]> {
    try {
      const client = getSupabaseClient();
      const { data, error } = await client.from(this.generalRemoveTagsTable).select('selector');

      if (error) throw error;
      if (!data) return [];

      return data.map((row: { selector: string }) => row.selector);
    } catch (error) {
      logError('Failed to get general remove tags', error);
      return [];
    }
  }
}
