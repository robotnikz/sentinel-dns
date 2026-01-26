import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';
import type { Db } from '../db.js';
import { requireAdmin } from '../auth.js';

export async function registerOpenApiRoutes(app: FastifyInstance, config: AppConfig, db: Db): Promise<void> {
	app.get('/api/openapi.json', async (request, reply) => {
		await requireAdmin(db, request);
		reply.header('cache-control', 'no-store');
		return {
			openapi: '3.0.0',
			info: {
				title: 'Sentinel DNS API',
				version: '0.0.0'
			},
			servers: [{ url: '/' }],
			paths: {},
			components: {}
		};
	});

	void config;
}
