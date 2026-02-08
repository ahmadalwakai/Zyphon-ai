import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@zyphon/db';
import { getAuthUser } from '@/lib/auth';
import { readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

// MIME type mapping
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

    // Find the artifact (use userArtifact for UserTask)
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

    // Construct full path - artifact.path should be absolute
    const fullPath = path.isAbsolute(artifact.path)
      ? artifact.path
      : path.join(artifact.task.workspacePath, artifact.path);

    // Security check - ensure path is within workspace or is the stored absolute path
    const normalizedPath = path.normalize(fullPath);
    const workspacePath = path.normalize(artifact.task.workspacePath);
    
    // Allow if path starts with workspace OR if using stored absolute path
    const isWithinWorkspace = normalizedPath.startsWith(workspacePath);
    const isStoredAbsolutePath = path.isAbsolute(artifact.path) && normalizedPath === path.normalize(artifact.path);
    
    if (!isWithinWorkspace && !isStoredAbsolutePath) {
      return NextResponse.json(
        { success: false, error: { message: 'Access denied' } },
        { status: 403 }
      );
    }

    // Check if file exists
    if (!existsSync(fullPath)) {
      return NextResponse.json(
        { success: false, error: { message: 'Artifact file not found on disk' } },
        { status: 404 }
      );
    }

    // Get file stats
    const stats = await stat(fullPath);
    
    // Size limit for direct serving (10MB)
    const MAX_SERVE_SIZE = 10 * 1024 * 1024;
    if (stats.size > MAX_SERVE_SIZE) {
      return NextResponse.json(
        { success: false, error: { message: 'Artifact too large for direct download' } },
        { status: 413 }
      );
    }

    // Read the file
    const content = await readFile(fullPath);
    const mimeType = getMimeType(fullPath);

    // Build response headers
    const headers: HeadersInit = {
      'Content-Type': mimeType,
      'Content-Length': stats.size.toString(),
    };

    if (download) {
      headers['Content-Disposition'] = `attachment; filename="${artifact.name}"`;
    } else {
      headers['Content-Disposition'] = `inline; filename="${artifact.name}"`;
    }

    // Cache images for 1 hour, text files for 5 minutes
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
