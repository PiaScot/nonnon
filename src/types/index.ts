/**
 * Type definitions and interfaces
 */

import { type Site } from '../models/schemas.js';

export interface ScrapingContext {
  sitesToScrape: Site[];
  generalRemoveTags: string[];
  allowedHosts: Set<string>;
}

export interface PaginationResult {
  hasNextPage: boolean;
  nextPageUrl?: string;
}

export interface ArticleProcessingResult {
  content: string;
  thumbnail: string;
}

// Re-export model types for convenience
export type { Article, Site, ScrapeOptions, Category } from '../models/schemas.js';
