/**
 * Supabase client manager (singleton pattern)
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { appConfig } from '../utils/config.js';
import { logger } from '../utils/logger.js';

/**
 * Singleton Supabase client manager
 */
class SupabaseClientManager {
  private static instance: SupabaseClientManager;
  private client: SupabaseClient | null = null;

  private constructor() {}

  public static getInstance(): SupabaseClientManager {
    if (!SupabaseClientManager.instance) {
      SupabaseClientManager.instance = new SupabaseClientManager();
    }
    return SupabaseClientManager.instance;
  }

  public getClient(): SupabaseClient {
    if (!this.client) {
      logger.info('Initializing Supabase client');
      this.client = createClient(appConfig.supabaseUrl, appConfig.supabaseRoleKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      });
    }
    return this.client;
  }

  /**
   * For testing: reset the client
   */
  public reset(): void {
    this.client = null;
  }
}

export const supabaseManager = SupabaseClientManager.getInstance();
export const getSupabaseClient = () => supabaseManager.getClient();
