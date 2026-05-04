export const dynamic = 'force-dynamic';

export async function GET() {
  const res = await fetch('http://api:3000/api/v1/stream', {
    headers: { Accept: 'text/event-stream' },
    cache: 'no-store'
  });

  return new Response(res.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
