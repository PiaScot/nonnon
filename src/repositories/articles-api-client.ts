/**
 * Client for articles-api (Cloudflare Workers)
 * Handles saving and retrieving article HTML content from R2
 */

import { logError, logInfo } from '../utils/logger.js';
import { appConfig } from '../utils/config.js';

interface ArticlePutResponse {
  success: boolean;
  key: string;
  size: number;
}

interface ErrorResponse {
  error: string;
  message: string;
}

export class ArticlesApiClient {
  private readonly baseUrl: string;
  private readonly apiSecret: string;

  constructor() {
    const { articlesApiUrl, articlesApiSecret } = appConfig;

    if (!articlesApiUrl) {
      throw new Error('ARTICLES_API_URL is not configured in environment variables');
    }

    if (!articlesApiSecret) {
      throw new Error('ARTICLES_API_SECRET is not configured in environment variables');
    }

    // Remove trailing slash if present
    this.baseUrl = articlesApiUrl.replace(/\/$/, '');
    this.apiSecret = articlesApiSecret;
  }

  /**
   * Save article HTML content to R2 via articles-api
   * @param articleId The article ID (from Supabase)
   * @param content The HTML content to save
   * @returns True if successful, false otherwise
   */
  async saveArticleContent(articleId: number, content: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/articles/${articleId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiSecret}`,
        },
        body: JSON.stringify({ content }),
      });

      if (!response.ok) {
        const errorData: ErrorResponse = await response.json();
        logError(
          `Failed to save article ${articleId} to R2: ${errorData.error} - ${errorData.message}`
        );
        return false;
      }

      const data: ArticlePutResponse = await response.json();
      logInfo(`Saved article ${articleId} to R2: ${data.key} (${data.size} bytes)`);
      return true;
    } catch (error) {
      logError(`Exception while saving article ${articleId} to R2`, error);
      return false;
    }
  }

  /**
   * Get article HTML content from R2 via articles-api
   * @param articleId The article ID
   * @returns The HTML content or null if not found
   */
  async getArticleContent(articleId: number): Promise<string | null> {
    try {
      const response = await fetch(`${this.baseUrl}/articles/${articleId}`, {
        method: 'GET',
      });

      if (response.status === 404) {
        logInfo(`Article ${articleId} not found in R2`);
        return null;
      }

      if (!response.ok) {
        const errorData: ErrorResponse = await response.json();
        logError(
          `Failed to retrieve article ${articleId} from R2: ${errorData.error} - ${errorData.message}`
        );
        return null;
      }

      return await response.text();
    } catch (error) {
      logError(`Exception while retrieving article ${articleId} from R2`, error);
      return null;
    }
  }

  /**
   * Delete article HTML content from R2 via articles-api
   * @param articleId The article ID
   * @returns True if successfully deleted, false otherwise
   */
  async deleteArticleContent(articleId: number): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/articles/${articleId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${this.apiSecret}`,
        },
      });

      if (response.status === 404) {
        logInfo(`Article ${articleId} not found in R2 (already deleted or never existed)`);
        return true; // Idempotent delete - consider it success
      }

      if (!response.ok) {
        const errorData: ErrorResponse = await response.json();
        logError(
          `Failed to delete article ${articleId} from R2: ${errorData.error} - ${errorData.message}`
        );
        return false;
      }

      logInfo(`Deleted article ${articleId} from R2`);
      return true;
    } catch (error) {
      logError(`Exception while deleting article ${articleId} from R2`, error);
      return false;
    }
  }

  /**
   * Health check for articles-api
   * @returns True if the API is healthy, false otherwise
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
      });

      if (!response.ok) {
        return false;
      }

      const data = await response.json();
      return data.status === 'ok';
    } catch (error) {
      logError('Health check failed for articles-api', error);
      return false;
    }
  }
}
