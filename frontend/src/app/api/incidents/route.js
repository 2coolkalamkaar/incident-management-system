import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // The Next.js server runs inside the Docker network.
    // It can talk directly to the Express backend container using 'http://api:3000'
    const res = await fetch('http://api:3000/api/v1/incidents', { cache: 'no-store' });
    
    if (!res.ok) {
      throw new Error(`Backend returned status: ${res.status}`);
    }
    
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("[Next.js API Proxy Error]", error);
    return NextResponse.json({ error: 'Failed to fetch from internal API' }, { status: 500 });
  }
}
