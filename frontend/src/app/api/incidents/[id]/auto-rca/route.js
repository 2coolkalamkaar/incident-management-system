import { NextResponse } from 'next/server';

export async function POST(request, context) {
  try {
    const { id } = await context.params;
    const res = await fetch(`http://api:3000/api/v1/incidents/${id}/auto-rca`, {
      method: 'POST'
    });
    
    if (!res.ok) {
      const error = await res.json();
      return NextResponse.json(error, { status: res.status });
    }
    
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Auto-RCA error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
