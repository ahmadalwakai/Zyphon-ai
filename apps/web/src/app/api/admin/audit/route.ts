import { NextRequest, NextResponse } from 'next/server';

const API_BASE = process.env.API_URL || 'http://localhost:3002';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = searchParams.get('page') || '1';
    const action = searchParams.get('action') || '';
    
    let url = `${API_BASE}/admin/audit?page=${page}`;
    if (action) url += `&action=${action}`;
    
    const res = await fetch(url);
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ data: [], pagination: { total: 0 }, error: 'Failed to fetch audit logs' }, { status: 500 });
  }
}
