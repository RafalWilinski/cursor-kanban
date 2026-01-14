export const config = {
  runtime: 'edge',
};

function corsHeaders(origin: string | null): Headers {
  const h = new Headers();
  h.set('Access-Control-Allow-Origin', origin ?? '*');
  h.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  h.set('Access-Control-Max-Age', '86400');
  h.set('Vary', 'Origin');
  return h;
}

function filterUpstreamHeaders(incoming: Headers): Headers {
  const out = new Headers();
  const allow = new Set(['authorization', 'content-type', 'accept', 'user-agent', 'x-request-id']);

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

  // With `vercel.json` rewrite:
  // /api/cursor/<path>?a=b  ->  /api/cursor?path=<path>&a=b
  const pathParam = url.searchParams.get('path') ?? '';
  const upstreamPath = `/${pathParam}`.replace(/\/+/, '/');

  // Forward any query params except `path`.
  const upstreamUrl = new URL(`https://api.cursor.com${upstreamPath}`);
  for (const [k, v] of url.searchParams.entries()) {
    if (k === 'path') continue;
    upstreamUrl.searchParams.append(k, v);
  }

  const upstreamRequest = new Request(upstreamUrl.toString(), {
    method: request.method,
    headers: filterUpstreamHeaders(request.headers),
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    redirect: 'manual',
  });

  const upstreamResponse = await fetch(upstreamRequest);

  const headers = new Headers(upstreamResponse.headers);
  // Remove hop-by-hop headers
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

