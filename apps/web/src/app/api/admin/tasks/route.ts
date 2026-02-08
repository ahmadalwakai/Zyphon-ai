import { NextRequest, NextResponse } from 'next/server';

const API_BASE = process.env.API_URL || 'http://localhost:3002';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = searchParams.get('page') || '1';
    const status = searchParams.get('status') || '';
    
    let url = `${API_BASE}/v1/tasks?page=${page}`;
    if (status) url += `&status=${status}`;
    
    const res = await fetch(url);
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ data: [], pagination: { total: 0 }, error: 'Failed to fetch tasks' }, { status: 500 });
  }
}
