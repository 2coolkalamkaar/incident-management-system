import { NextResponse } from 'next/server';

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const res = await fetch(`http://api:3000/api/v1/incidents/${id}/signals`, { cache: 'no-store' });
    
    if (!res.ok) {
      throw new Error(`Backend returned status: ${res.status}`);
    }
    
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("[Next.js API Proxy Error]", error);
    return NextResponse.json({ error: 'Failed to fetch signals from internal API' }, { status: 500 });
  }
}
