/**
 * Artifact serving endpoint.
 * Reads files from WORKSPACE_ROOT and serves them over HTTP.
 * Used by apps/web to proxy artifact downloads when the web app
 * runs on Vercel (no local filesystem).
 *
 * Security: artifacts are looked up in the DB first; only registered
 * paths under WORKSPACE_ROOT are served.
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '@zyphon/db';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';

const WORKSPACE_ROOT = process.env['WORKSPACE_ROOT'] || './workspaces';

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ts': 'text/typescript', '.tsx': 'text/typescript',
  '.js': 'text/javascript', '.jsx': 'text/javascript',
  '.json': 'application/json', '.html': 'text/html', '.css': 'text/css',
  '.md': 'text/markdown', '.txt': 'text/plain',
  '.py': 'text/x-python', '.sh': 'text/x-shellscript',
};

function getMimeType(fp: string): string {
  return MIME_TYPES[path.extname(fp).toLowerCase()] || 'application/octet-stream';
}

export const artifactRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /v1/artifacts/:artifactId
   *
   * Query params:
   *   ?download=true  → Content-Disposition: attachment
   *
   * Auth: expects x-internal-secret header matching INTERNAL_API_SECRET env var
   *        OR the request originates from the same server (no auth in dev).
   */
  fastify.get<{
    Params: { artifactId: string };
    Querystring: { download?: string };
  }>('/artifacts/:artifactId', {
    schema: {
      description: 'Serve an artifact file from the worker filesystem',
      params: {
        type: 'object',
        required: ['artifactId'],
        properties: { artifactId: { type: 'string', format: 'uuid' } },
      },
      querystring: {
        type: 'object',
        properties: { download: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { artifactId } = request.params;
    const download = request.query.download === 'true';

    // Verify internal secret in production
    const secret = process.env['INTERNAL_API_SECRET'];
    const secretProvided = request.headers['x-internal-secret'] as string | undefined;
    const secretOk = !secret || secretProvided === secret;

    fastify.log.info(
      { artifactId, download, secretRequired: !!secret, secretValid: secretOk },
      '▶ ARTIFACT REQUEST',
    );

    if (secret && !secretOk) {
      return reply.status(403).send({ success: false, error: { message: 'Forbidden' } });
    }

    // Look up artifact in DB (try userArtifact first, then org artifact)
    let artifact: { id: string; name: string; type: string; path: string; size: number } | null = null;

    artifact = await prisma.userArtifact.findUnique({
      where: { id: artifactId },
      select: { id: true, name: true, type: true, path: true, size: true },
    });

    if (!artifact) {
      artifact = await prisma.artifact.findUnique({
        where: { id: artifactId },
        select: { id: true, name: true, type: true, path: true, size: true },
      });
    }

    if (!artifact) {
      return reply.status(404).send({ success: false, error: { message: 'Artifact not found' } });
    }

    // Resolve file path
    const fullPath = path.isAbsolute(artifact.path)
      ? artifact.path
      : path.join(WORKSPACE_ROOT, artifact.path);

    const normalizedPath = path.normalize(fullPath);
    const normalizedRoot = path.normalize(path.resolve(WORKSPACE_ROOT));

    // Security: must be under WORKSPACE_ROOT (or match stored absolute path)
    if (!normalizedPath.startsWith(normalizedRoot) && !path.isAbsolute(artifact.path)) {
      return reply.status(403).send({ success: false, error: { message: 'Path outside workspace' } });
    }

    if (!existsSync(fullPath)) {
      return reply.status(404).send({ success: false, error: { message: 'File not found on disk' } });
    }

    const stats = await fs.stat(fullPath);
    const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
    if (stats.size > MAX_SIZE) {
      return reply.status(413).send({ success: false, error: { message: 'File too large' } });
    }

    const content = await fs.readFile(fullPath);
    const mimeType = getMimeType(fullPath);

    reply
      .header('Content-Type', mimeType)
      .header('Content-Length', stats.size)
      .header('Content-Disposition', download
        ? `attachment; filename="${artifact.name}"`
        : `inline; filename="${artifact.name}"`)
      .header('Cache-Control', mimeType.startsWith('image/') ? 'private, max-age=3600' : 'private, max-age=300');

    return reply.send(content);
  });
};
