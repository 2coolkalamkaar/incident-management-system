import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const res = await fetch('http://api:3000/api/v1/analytics/mttr', { cache: 'no-store' });
    
    if (!res.ok) {
      throw new Error(`Backend returned status: ${res.status}`);
    }
    
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("[Next.js MTTR Proxy Error]", error);
    return NextResponse.json({ error: 'Failed to fetch MTTR from internal API' }, { status: 500 });
  }
}
