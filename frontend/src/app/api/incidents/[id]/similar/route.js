import { NextResponse } from 'next/server';

export async function GET(request, context) {
  try {
    const { id } = await context.params;
    const res = await fetch(`http://api:3000/api/v1/incidents/${id}/similar`);
    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch similar incidents' }, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Fetch similar error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
