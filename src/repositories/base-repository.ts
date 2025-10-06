/**
 * Base repository class
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from './supabase-client.js';

export abstract class BaseRepository {
  protected tableName: string;
  protected client: SupabaseClient;

  constructor(tableName: string) {
    this.tableName = tableName;
    this.client = getSupabaseClient();
  }

  /**
   * Get the Supabase client
   */
  protected getClient(): SupabaseClient {
    return this.client;
  }
}
