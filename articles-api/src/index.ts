/**
 * articles-api: Cloudflare Workers API for managing article HTML content in R2
 *
 * Endpoints:
 * - GET /articles/:id - Retrieve article HTML from R2
 * - PUT /articles/:id - Store article HTML to R2 (requires auth)
 * - DELETE /articles/:id - Delete article HTML from R2 (requires auth)
 * - GET /health - Health check
 *
 * Usage:
 * - Run locally: `pnpm dev`
 * - Deploy: `pnpm deploy`
 * - Test: `pnpm test`
 */

import { Hono } from 'hono';

interface ArticlePutRequest {
	content: string;
}

interface ArticlePutResponse {
	success: boolean;
	key: string;
	size: number;
}

interface ArticleDeleteResponse {
	success: boolean;
	key: string;
	deleted: boolean;
}

interface ErrorResponse {
	error: string;
	message: string;
}

const app = new Hono<{ Bindings: Env }>();

/**
 * Health check endpoint
 */
app.get('/health', (c) => {
	return c.json({
		status: 'ok',
		timestamp: new Date().toISOString(),
	});
});

/**
 * GET /articles/:id
 * Retrieves article HTML from R2 bucket
 */
app.get('/articles/:id', async (c) => {
	const articleId = c.req.param('id');

	try {
		const key = `${articleId}.html`;
		const object = await c.env.articles_html.get(key);

		if (!object) {
			return c.json<ErrorResponse>(
				{
					error: 'Not Found',
					message: `Article ${articleId} not found in R2`,
				},
				404,
			);
		}

		// Return HTML content with caching headers
		return c.body(object.body, 200, {
			'Content-Type': 'text/html; charset=utf-8',
			'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
			ETag: object.httpEtag || '',
		});
	} catch (error) {
		console.error(`Error fetching article ${articleId}:`, error);
		return c.json<ErrorResponse>(
			{
				error: 'Internal Server Error',
				message: error instanceof Error ? error.message : 'Unknown error',
			},
			500,
		);
	}
});

/**
 * PUT /articles/:id
 * Stores article HTML to R2 bucket
 * Requires Bearer token authentication
 */
app.put('/articles/:id', async (c) => {
	const articleId = c.req.param('id');

	// Authentication check
	const authHeader = c.req.header('Authorization');
	if (!authHeader || !authHeader.startsWith('Bearer ')) {
		return c.json<ErrorResponse>(
			{
				error: 'Unauthorized',
				message: 'Missing or invalid Authorization header',
			},
			401,
		);
	}

	const token = authHeader.substring(7); // Remove 'Bearer ' prefix
	if (token !== c.env.API_SECRET) {
		return c.json<ErrorResponse>(
			{
				error: 'Unauthorized',
				message: 'Invalid API token',
			},
			401,
		);
	}

	try {
		// Parse and validate request body
		const body = await c.req.json<ArticlePutRequest>();

		if (!body.content || typeof body.content !== 'string') {
			return c.json<ErrorResponse>(
				{
					error: 'Bad Request',
					message: 'Missing or invalid "content" field',
				},
				400,
			);
		}

		// Store in R2
		const key = `${articleId}.html`;
		await c.env.articles_html.put(key, body.content, {
			httpMetadata: {
				contentType: 'text/html; charset=utf-8',
			},
		});

		// Return success response
		return c.json<ArticlePutResponse>({
			success: true,
			key,
			size: new Blob([body.content]).size,
		});
	} catch (error) {
		// Handle JSON parse errors
		if (error instanceof SyntaxError) {
			return c.json<ErrorResponse>(
				{
					error: 'Bad Request',
					message: 'Invalid JSON body',
				},
				400,
			);
		}

		console.error(`Error storing article ${articleId}:`, error);
		return c.json<ErrorResponse>(
			{
				error: 'Internal Server Error',
				message: error instanceof Error ? error.message : 'Unknown error',
			},
			500,
		);
	}
});

/**
 * DELETE /articles/:id
 * Deletes article HTML from R2 bucket
 * Requires Bearer token authentication
 */
app.delete('/articles/:id', async (c) => {
	const articleId = c.req.param('id');

	// Authentication check
	const authHeader = c.req.header('Authorization');
	if (!authHeader || !authHeader.startsWith('Bearer ')) {
		return c.json<ErrorResponse>(
			{
				error: 'Unauthorized',
				message: 'Missing or invalid Authorization header',
			},
			401,
		);
	}

	const token = authHeader.substring(7); // Remove 'Bearer ' prefix
	if (token !== c.env.API_SECRET) {
		return c.json<ErrorResponse>(
			{
				error: 'Unauthorized',
				message: 'Invalid API token',
			},
			401,
		);
	}

	try {
		const key = `${articleId}.html`;

		// Check if file exists before deleting
		const object = await c.env.articles_html.get(key);

		if (!object) {
			// File doesn't exist, but we'll return success anyway
			// (idempotent delete - deleting non-existent file is OK)
			return c.json<ArticleDeleteResponse>({
				success: true,
				key,
				deleted: false, // Wasn't there to delete
			});
		}

		// Delete from R2
		await c.env.articles_html.delete(key);

		return c.json<ArticleDeleteResponse>({
			success: true,
			key,
			deleted: true,
		});
	} catch (error) {
		console.error(`Error deleting article ${articleId}:`, error);
		return c.json<ErrorResponse>(
			{
				error: 'Internal Server Error',
				message: error instanceof Error ? error.message : 'Unknown error',
			},
			500,
		);
	}
});

// 404 handler
app.notFound((c) => {
	return c.json<ErrorResponse>(
		{
			error: 'Not Found',
			message: `Route ${c.req.method} ${c.req.path} not found`,
		},
		404,
	);
});

export default app;
