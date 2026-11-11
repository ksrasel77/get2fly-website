export async function onRequest(context) {
  const url = new URL(context.request.url);
  const SUPABASE_HOST = 'sfoxqtmpfybdjgsczgbj.supabase.co';

  // Replace the incoming hostname with your Supabase backend host
  url.hostname = SUPABASE_HOST;

  // Rewrite the path so /auth/... maps correctly to Supabase's /auth/...
  // context.request.url will carry over query params automatically

  const modifiedRequest = new Request(url.toString(), {
    method: context.request.method,
    headers: context.request.headers,
    body: context.request.body,
    redirect: 'manual'
  });

  // Fetch the response from Supabase
  let response = await fetch(modifiedRequest);

  // If Supabase sends a location redirect header, rewrite it to your custom domain
  const location = response.headers.get('location');
  if (location && location.includes(SUPABASE_HOST)) {
    const newHeaders = new Headers(response.headers);
    newHeaders.set('location', location.replace(SUPABASE_HOST, 'get2fly.com'));
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders
    });
  }

  return response;
}