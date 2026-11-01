// Minimal OpenAI Chat Completions client (browser fetch, JSON-mode output).
import { parseJSON } from './util.js';

export async function chatJSON({ settings, system, user, signal }) {
  const base = (settings.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  let res;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.openaiKey.trim()}`,
      },
      body: JSON.stringify({
        model: settings.model.trim(),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: { type: 'json_object' },
      }),
    });
  } catch (err) {
    throw new Error(`Could not reach the OpenAI API (${err.message}).`);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = body?.error?.message || res.statusText;
    if (res.status === 401) throw new Error(`OpenAI rejected the API key (401). ${msg}`);
    if (res.status === 404) throw new Error(`OpenAI: model "${settings.model}" not found or not available to this key. ${msg}`);
    throw new Error(`OpenAI error ${res.status}: ${msg}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI returned an empty response.');
  return parseJSON(content);
}
