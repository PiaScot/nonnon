/**
 * Data models with Zod validation schemas
 */

import { z } from 'zod';

/**
 * Scrape options for site-specific configurations
 */
export const ScrapeOptionsSchema = z.object({
  remove_selector_tags: z.array(z.string()),
  display_mode: z.enum(['in_app', 'direct_link']),
  fetch_strategy: z.enum(['crawlee', 'fetch']).default('crawlee'),
});

export type ScrapeOptions = z.infer<typeof ScrapeOptionsSchema>;

/**
 * Site model
 */
export const SiteSchema = z.object({
  id: z.number(),
  url: z.string().url(),
  domain: z.string(),
  title: z.string(),
  rss: z.string().url(),
  category: z.string().nullable().optional(),
  last_access: z.string(),
  scrape_interval_seconds: z.number().nullable(),
  scrape_options: ScrapeOptionsSchema.nullable(),
});

export type Site = z.infer<typeof SiteSchema>;

/**
 * Article model
 */
export const ArticleSchema = z.object({
  id: z.number().optional(),
  site_id: z.number(),
  title: z.string(),
  url: z.string().url(),
  content: z.string(),
  pub_date: z.string(),
  thumbnail: z.string().default(''),
  created_at: z.string().optional(),
});

export type Article = z.infer<typeof ArticleSchema>;

/**
 * Category model
 */
export const CategorySchema = z.object({
  id: z.string(),
  label: z.string(),
  visible: z.boolean(),
  super_category_id: z.number(),
  user_id: z.string().nullable(),
});

export type Category = z.infer<typeof CategorySchema>;

/**
 * RSS Feed Entry (from rss-parser)
 */
export const RSSFeedEntrySchema = z.object({
  title: z.string().optional(),
  link: z.string().optional(),
  pubDate: z.string().optional(),
  'content:encoded': z.string().optional(),
  content: z.string().optional(),
  isoDate: z.string().optional(),
});

export type RSSFeedEntry = z.infer<typeof RSSFeedEntrySchema>;

/**
 * Validation helpers
 */
export function validateSite(data: unknown): Site {
  return SiteSchema.parse(data);
}

export function validateArticle(data: unknown): Article {
  return ArticleSchema.parse(data);
}

export function validateCategory(data: unknown): Category {
  return CategorySchema.parse(data);
}

/**
 * Safe parsing with error handling
 */

export function safeParseSite(
  data: unknown
): { success: true; data: Site } | { success: false; error: z.ZodError } {
  const result = SiteSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

export function safeParseArticle(
  data: unknown
): { success: true; data: Article } | { success: false; error: z.ZodError } {
  const result = ArticleSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}
