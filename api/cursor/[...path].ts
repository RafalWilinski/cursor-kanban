export const config = {
  runtime: 'edge',
};

function corsHeaders(origin: string | null): Headers {
  const h = new Headers();
  // Same-origin requests don't require CORS, but setting these makes the endpoint
  // resilient when called from other origins (e.g. previews).
  h.set('Access-Control-Allow-Origin', origin ?? '*');
  h.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  h.set('Access-Control-Max-Age', '86400');
  h.set('Vary', 'Origin');
  return h;
}

function filterUpstreamHeaders(incoming: Headers): Headers {
  const out = new Headers();

  // Only forward headers that matter to Cursor API.
  const allow = new Set([
    'authorization',
    'content-type',
    'accept',
    'user-agent',
    'x-request-id',
  ]);

  for (const [k, v] of incoming.entries()) {
    if (allow.has(k.toLowerCase())) out.set(k, v);
  }

  return out;
}

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get('origin');

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  // Map: /api/cursor/<path>  ->  https://api.cursor.com/<path>
  const upstreamPath = url.pathname.replace(/^\/api\/cursor/, '') || '/';
  const upstreamUrl = new URL(`https://api.cursor.com${upstreamPath}`);
  upstreamUrl.search = url.search;

  const upstreamRequest = new Request(upstreamUrl.toString(), {
    method: request.method,
    headers: filterUpstreamHeaders(request.headers),
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    redirect: 'manual',
  });

  const upstreamResponse = await fetch(upstreamRequest);

  // Copy upstream headers through, but ensure CORS and strip hop-by-hop headers.
  const headers = new Headers(upstreamResponse.headers);
  headers.delete('connection');
  headers.delete('keep-alive');
  headers.delete('proxy-authenticate');
  headers.delete('proxy-authorization');
  headers.delete('te');
  headers.delete('trailer');
  headers.delete('transfer-encoding');
  headers.delete('upgrade');

  const cors = corsHeaders(origin);
  for (const [k, v] of cors.entries()) headers.set(k, v);

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers,
  });
}

