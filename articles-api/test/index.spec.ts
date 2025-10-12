import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import app from '../src/index';

describe('articles-api', () => {
	const testArticleId = '12345';
	const testContent = '<html><body><h1>Test Article</h1><p>Content here</p></body></html>';
	const testApiSecret = 'test-secret-token-12345';

	describe('Health check', () => {
		it('GET /health returns 200 OK', async () => {
			const request = new Request('http://example.com/health', {
				method: 'GET',
			});
			const response = await app.fetch(request, env);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data).toHaveProperty('status', 'ok');
			expect(data).toHaveProperty('timestamp');
		});
	});

	describe('PUT /articles/:id', () => {
		it('stores article content to R2 with valid token', async () => {
			const testEnv = { ...env, API_SECRET: testApiSecret };
			const request = new Request(`http://example.com/articles/${testArticleId}`, {
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${testApiSecret}`,
				},
				body: JSON.stringify({ content: testContent }),
			});
			const response = await app.fetch(request, testEnv);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data).toMatchObject({
				success: true,
				key: `${testArticleId}.html`,
			});
			expect(data.size).toBeGreaterThan(0);
		});

		it('returns 401 for missing Authorization header', async () => {
			const testEnv = { ...env, API_SECRET: testApiSecret };
			const request = new Request(`http://example.com/articles/${testArticleId}`, {
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ content: testContent }),
			});
			const response = await app.fetch(request, testEnv);

			expect(response.status).toBe(401);
			const data = await response.json();
			expect(data).toHaveProperty('error', 'Unauthorized');
		});

		it('returns 401 for invalid token', async () => {
			const testEnv = { ...env, API_SECRET: testApiSecret };
			const request = new Request(`http://example.com/articles/${testArticleId}`, {
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': 'Bearer wrong-token',
				},
				body: JSON.stringify({ content: testContent }),
			});
			const response = await app.fetch(request, testEnv);

			expect(response.status).toBe(401);
			const data = await response.json();
			expect(data).toHaveProperty('error', 'Unauthorized');
		});

		it('returns 400 for invalid JSON', async () => {
			const testEnv = { ...env, API_SECRET: testApiSecret };
			const request = new Request(`http://example.com/articles/${testArticleId}`, {
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${testApiSecret}`,
				},
				body: 'invalid json',
			});
			const response = await app.fetch(request, testEnv);

			expect(response.status).toBe(400);
			const data = await response.json();
			expect(data).toHaveProperty('error', 'Bad Request');
		});

		it('returns 400 for missing content field', async () => {
			const testEnv = { ...env, API_SECRET: testApiSecret };
			const request = new Request(`http://example.com/articles/${testArticleId}`, {
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${testApiSecret}`,
				},
				body: JSON.stringify({ foo: 'bar' }),
			});
			const response = await app.fetch(request, testEnv);

			expect(response.status).toBe(400);
			const data = await response.json();
			expect(data).toHaveProperty('error', 'Bad Request');
			expect(data.message).toContain('content');
		});
	});

	describe('GET /articles/:id', () => {
		beforeEach(async () => {
			// Setup: Store test article
			const testEnv = { ...env, API_SECRET: testApiSecret };
			const request = new Request(`http://example.com/articles/${testArticleId}`, {
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${testApiSecret}`,
				},
				body: JSON.stringify({ content: testContent }),
			});
			await app.fetch(request, testEnv);
		});

		it('retrieves article content from R2', async () => {
			const request = new Request(`http://example.com/articles/${testArticleId}`, {
				method: 'GET',
			});
			const response = await app.fetch(request, env);

			expect(response.status).toBe(200);
			expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
			const html = await response.text();
			expect(html).toBe(testContent);
		});

		it('returns 404 for non-existent article', async () => {
			const request = new Request(`http://example.com/articles/999999`, {
				method: 'GET',
			});
			const response = await app.fetch(request, env);

			expect(response.status).toBe(404);
			const data = await response.json();
			expect(data).toHaveProperty('error', 'Not Found');
		});
	});

	describe('DELETE /articles/:id', () => {
		beforeEach(async () => {
			// Setup: Store test article
			const testEnv = { ...env, API_SECRET: testApiSecret };
			const request = new Request(`http://example.com/articles/${testArticleId}`, {
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${testApiSecret}`,
				},
				body: JSON.stringify({ content: testContent }),
			});
			await app.fetch(request, testEnv);
		});

		it('deletes article from R2 with valid token', async () => {
			const testEnv = { ...env, API_SECRET: testApiSecret };
			const request = new Request(`http://example.com/articles/${testArticleId}`, {
				method: 'DELETE',
				headers: {
					'Authorization': `Bearer ${testApiSecret}`,
				},
			});
			const response = await app.fetch(request, testEnv);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data).toMatchObject({
				success: true,
				key: `${testArticleId}.html`,
				deleted: true,
			});
		});

		it('returns success for deleting non-existent article (idempotent)', async () => {
			const testEnv = { ...env, API_SECRET: testApiSecret };
			const request = new Request(`http://example.com/articles/999999`, {
				method: 'DELETE',
				headers: {
					'Authorization': `Bearer ${testApiSecret}`,
				},
			});
			const response = await app.fetch(request, testEnv);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data).toMatchObject({
				success: true,
				key: '999999.html',
				deleted: false, // Wasn't there to delete
			});
		});

		it('returns 401 for missing Authorization header', async () => {
			const testEnv = { ...env, API_SECRET: testApiSecret };
			const request = new Request(`http://example.com/articles/${testArticleId}`, {
				method: 'DELETE',
			});
			const response = await app.fetch(request, testEnv);

			expect(response.status).toBe(401);
			const data = await response.json();
			expect(data).toHaveProperty('error', 'Unauthorized');
		});

		it('returns 401 for invalid token', async () => {
			const testEnv = { ...env, API_SECRET: testApiSecret };
			const request = new Request(`http://example.com/articles/${testArticleId}`, {
				method: 'DELETE',
				headers: {
					'Authorization': 'Bearer wrong-token',
				},
			});
			const response = await app.fetch(request, testEnv);

			expect(response.status).toBe(401);
			const data = await response.json();
			expect(data).toHaveProperty('error', 'Unauthorized');
		});
	});

	describe('404 handling', () => {
		it('returns 404 for unknown routes', async () => {
			const request = new Request('http://example.com/unknown', {
				method: 'GET',
			});
			const response = await app.fetch(request, env);

			expect(response.status).toBe(404);
			const data = await response.json();
			expect(data).toHaveProperty('error', 'Not Found');
		});
	});
});
