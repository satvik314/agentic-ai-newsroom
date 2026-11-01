// SerpAPI Google News search, called through the /api/serp proxy (see vite.config.js).
export async function searchNews({ apiKey, query, recency = 'qdr:w', num = 10 }) {
  const params = new URLSearchParams({
    engine: 'google',
    tbm: 'nws',
    q: query,
    tbs: recency,
    num: String(num),
    hl: 'en',
    gl: 'us',
    api_key: apiKey.trim(),
  });

  let res;
  try {
    res = await fetch(`/api/serp?${params}`);
  } catch (err) {
    throw new Error(`Could not reach the SerpAPI proxy (${err.message}). Run the app with "npm run dev".`);
  }
  const data = await res.json().catch(() => null);
  if (!data) throw new Error(`SerpAPI proxy returned ${res.status} with no JSON. Is /api/serp configured?`);

  if (data.error) {
    // SerpAPI reports "no results" as an error; treat it as an empty result set.
    if (/hasn't returned any results/i.test(data.error)) return [];
    throw new Error(`SerpAPI: ${data.error}`);
  }

  return (data.news_results || [])
    .filter((r) => r.title && /^https?:\/\//i.test(r.link || ''))
    .map((r) => ({
      title: r.title,
      url: r.link,
      source: typeof r.source === 'string' ? r.source : r.source?.name || '',
      date: r.date || '',
      snippet: r.snippet || '',
      query,
    }));
}
