// Serverless proxy for SerpAPI (Vercel-style: deploy with the `api/` folder).
// The browser can't call serpapi.com directly because of CORS, so the app
// calls /api/serp?...; this forwards the query string (including the user's
// api_key entered in the UI) to SerpAPI and relays the JSON response.
export default async function handler(req, res) {
  const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '';
  try {
    const upstream = await fetch(`https://serpapi.com/search.json?${query}`);
    const body = await upstream.text();
    res.statusCode = upstream.status;
    res.setHeader('Content-Type', 'application/json');
    res.end(body);
  } catch (err) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: `Proxy error: ${err.message}` }));
  }
}
