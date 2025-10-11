/**
 * Configuration management with validation
 */

import { config } from 'dotenv';
import { z } from 'zod';

// Load environment variables
config();

/**
 * Configuration schema with validation
 */
const ConfigSchema = z.object({
  // Supabase
  supabaseUrl: z.string().url('SUPABASE_URL must be a valid URL'),
  supabaseRoleKey: z.string().min(1, 'SUPABASE_ROLE_KEY is required'),

  // Database tables
  articleTable: z.string(),
  siteTable: z.string(),
  categoryTable: z.string(),
  superCategoryTable: z.string(),
  bookmarkTable: z.string(),
  allowHostTable: z.string(),
  generalRemoveTagsTable: z.string(),

  // RPC functions
  getSitesToScrapeRpc: z.string(),


  // Couldflare

  // cloudflareAccountId: z.string(),
  // d1DatabaseId: z.string(),
  // cloudflareApiToken: z.string(),
  //
  // r2AccountId: z.string(),
  // r2AccessKeyId: z.string(),
  // r2SecretAccessKey: z.string(),

  // Application settings
  maxArticles: z.number().int().positive(),
  batchSize: z.number().int().positive(),
  scrapeConcurrency: z.number().int().positive().default(5),

  // Environment
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),

  // User agents
  pcUserAgents: z
    .array(z.string())
    .default([
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) Gecko/20100101 Firefox/126.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    ]),

  mobileUserAgents: z
    .array(z.string())
    .default([
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.78 Mobile Safari/537.36',
      'Mozilla/5.0 (Android 14; Mobile; rv:126.0) Gecko/126.0 Firefox/126.0',
    ]),

  // Allowed script hosts
  allowedScriptHosts: z
    .set(z.string())
    .default(new Set(['twitter.com', 'platform.twitter.com', 'x.com'])),

  // Lazy loading attributes
  lazyAttrs: z.array(z.string()).default(['data-src', 'data-lazy-src', 'data-original']),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

/**
 * Load and validate configuration
 */
function loadConfig(): AppConfig {
  const rawConfig = {
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseRoleKey: process.env.SUPABASE_ROLE_KEY,
    articleTable: process.env.ARTICLE_TABLE,
    siteTable: process.env.SITE_TABLE,
    categoryTable: process.env.CATEGORY_TABLE,
    bookmarkTable: process.env.BOOKMARK_TABLE,
    superCategoryTable: process.env.SUPER_CATEGORY_TABLE,
    allowHostTable: process.env.ALLOW_HOST_TABLE,
    generalRemoveTagsTable: process.env.GENERAL_REMOVE_TAGS_TABLE,
    getSitesToScrapeRpc: process.env.GET_SITES_TO_SCRAPE_RPC,


    cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    d1DatabaseId: process.env.D1_DATABASE_ID,
    cloudflareApiToken: process.env.CLOUDFLARE_API_TOKEN,

    r2AccountId: process.env.R2_ACCOUNT_ID,
    r2AccessKeyId: process.env.R2_ACCESS_KEY_ID,
    r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    maxArticles: process.env.MAX_ARTICLES ? parseInt(process.env.MAX_ARTICLES, 10) : undefined,
    batchSize: process.env.BATCH_SIZE ? parseInt(process.env.BATCH_SIZE, 10) : undefined,
    scrapeConcurrency: process.env.SCRAPE_CONCURRENCY
      ? parseInt(process.env.SCRAPE_CONCURRENCY, 10)
      : undefined,
    nodeEnv: process.env.NODE_ENV,
    pcUserAgents: undefined,
    mobileUserAgents: undefined,
    allowedScriptHosts: undefined,
    lazyAttrs: undefined,
  };

  try {
    return ConfigSchema.parse(rawConfig);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('Configuration validation failed:');
      error.errors.forEach((err) => {
        console.error(`  - ${err.path.join('.')}: ${err.message}`);
      });
      throw new Error('Invalid configuration. Please check your environment variables.');
    }
    throw error;
  }
}

/**
 * Singleton configuration instance
 */
export const appConfig = loadConfig();

/**
 * Regular expressions for media detection
 */
export const MEDIA_REGEX = /\.(jpe?g|png|gif|webp|mp4|webm|mov|m4v)(\?.*)?$/i;
export const VIDEO_REGEX = /\.(mp4|webm|mov|m4v)$/i;
