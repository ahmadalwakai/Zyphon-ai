import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@zyphon/db';
import { getAuthUser } from '../../../../../../../lib/auth';
import { readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

/**
 * When INTERNAL_API_URL is set (e.g. on Vercel), proxy artifact requests
 * to the self-hosted API server.  Otherwise serve from the local filesystem.
 */
const INTERNAL_API_URL = process.env['INTERNAL_API_URL'] || process.env['NEXT_PUBLIC_API_URL'] || '';
const INTERNAL_API_SECRET = process.env['INTERNAL_API_SECRET'] || '';

// MIME type mapping (only used for local-disk fallback)
const mimeTypes: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.js': 'text/javascript',
  '.jsx': 'text/javascript',
  '.json': 'application/json',
  '.html': 'text/html',
  '.css': 'text/css',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.py': 'text/x-python',
  '.sh': 'text/x-shellscript',
};

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return mimeTypes[ext] || 'application/octet-stream';
}

// GET /api/user/tasks/[id]/artifacts/[artifactId] - Download/view artifact content
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; artifactId: string }> }
) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: { message: 'Unauthorized' } },
        { status: 401 }
      );
    }

    const { id: taskId, artifactId } = await params;
    const { searchParams } = new URL(request.url);
    const download = searchParams.get('download') === 'true';

    // Find the artifact and verify ownership
    const artifact = await prisma.userArtifact.findFirst({
      where: {
        id: artifactId,
        taskId,
        task: {
          workspace: { userId: user.id, deletedAt: null },
        },
      },
      include: {
        task: {
          select: { workspacePath: true },
        },
      },
    });

    if (!artifact) {
      return NextResponse.json(
        { success: false, error: { message: 'Artifact not found' } },
        { status: 404 }
      );
    }

    // ── Proxy mode (Vercel / remote API) ─────────────────────────────
    if (INTERNAL_API_URL) {
      const apiUrl = `${INTERNAL_API_URL.replace(/\/$/, '')}/v1/artifacts/${artifactId}${download ? '?download=true' : ''}`;
      const headers: HeadersInit = {};
      if (INTERNAL_API_SECRET) {
        headers['x-internal-secret'] = INTERNAL_API_SECRET;
      }

      const upstream = await fetch(apiUrl, { headers });
      if (!upstream.ok) {
        const body = await upstream.text().catch(() => '');
        console.error(`Artifact proxy failed (${upstream.status}): ${body}`);
        return NextResponse.json(
          { success: false, error: { message: 'Failed to fetch artifact from API' } },
          { status: upstream.status }
        );
      }

      // Forward response headers from the API
      const responseHeaders: HeadersInit = {};
      for (const key of ['content-type', 'content-length', 'content-disposition', 'cache-control']) {
        const val = upstream.headers.get(key);
        if (val) responseHeaders[key] = val;
      }

      return new NextResponse(upstream.body as any, {
        status: 200,
        headers: responseHeaders,
      });
    }

    // ── Local-disk mode (self-hosted / same machine) ─────────────────
    const fullPath = path.isAbsolute(artifact.path)
      ? artifact.path
      : path.join(artifact.task.workspacePath, artifact.path);

    // Security check
    const normalizedPath = path.normalize(fullPath);
    const workspacePath = path.normalize(artifact.task.workspacePath);
    const isWithinWorkspace = normalizedPath.startsWith(workspacePath);
    const isStoredAbsolutePath = path.isAbsolute(artifact.path) && normalizedPath === path.normalize(artifact.path);

    if (!isWithinWorkspace && !isStoredAbsolutePath) {
      return NextResponse.json(
        { success: false, error: { message: 'Access denied' } },
        { status: 403 }
      );
    }

    if (!existsSync(fullPath)) {
      return NextResponse.json(
        { success: false, error: { message: 'Artifact file not found on disk' } },
        { status: 404 }
      );
    }

    const stats = await stat(fullPath);
    const MAX_SERVE_SIZE = 10 * 1024 * 1024;
    if (stats.size > MAX_SERVE_SIZE) {
      return NextResponse.json(
        { success: false, error: { message: 'Artifact too large for direct download' } },
        { status: 413 }
      );
    }

    const content = await readFile(fullPath);
    const mimeType = getMimeType(fullPath);

    const headers: HeadersInit = {
      'Content-Type': mimeType,
      'Content-Length': stats.size.toString(),
    };

    if (download) {
      headers['Content-Disposition'] = `attachment; filename="${artifact.name}"`;
    } else {
      headers['Content-Disposition'] = `inline; filename="${artifact.name}"`;
    }

    if (mimeType.startsWith('image/')) {
      headers['Cache-Control'] = 'private, max-age=3600';
    } else {
      headers['Cache-Control'] = 'private, max-age=300';
    }

    return new NextResponse(content, { status: 200, headers });
  } catch (error) {
    console.error('Artifact download error:', error);
    return NextResponse.json(
      { success: false, error: { message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
