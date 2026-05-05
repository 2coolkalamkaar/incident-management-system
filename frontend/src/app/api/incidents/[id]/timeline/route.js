import { NextResponse } from 'next/server';

export async function GET(request, context) {
  try {
    const { id } = await context.params;
    const res = await fetch(`http://api:3000/api/v1/incidents/${id}/timeline`);
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error('Timeline proxy error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
