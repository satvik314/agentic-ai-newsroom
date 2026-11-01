// Research Agent
// 1. Plans Google News queries for the latest AI news (LLM)
// 2. Runs them in parallel against SerpAPI
// 3. Synthesizes 10 grounded content ideas (LLM), citing the articles it used
// Human feedback can then refine the list (keep picked ideas, replace the rest).
import { chatJSON } from '../lib/llm.js';
import { searchNews } from '../lib/serp.js';
import { mapPool, todayISO } from '../lib/util.js';

const MAX_ARTICLES = 60;

const DEFAULT_QUERIES = [
  'AI agents',
  'agentic AI enterprise',
  'OpenAI announcement',
  'Anthropic Claude',
  'Google Gemini AI',
  'open source LLM release',
  'AI coding agents developers',
  'AI startup funding',
];

const RECENCY_LABEL = { 'qdr:d': 'the past 24 hours', 'qdr:w': 'the past week', 'qdr:m': 'the past month' };

const AUDIENCES = `The ideas will be turned into:
- LinkedIn posts for senior technical professionals (10–20 years of experience: architects, engineering managers, staff engineers, CTOs). Technically strong, but many are new to agentic AI.
- X/Twitter threads for developers at tech startups in San Francisco and the Bay Area. They ship fast, know APIs and LLMs, and dislike hype.`;

const PLANNER_SYSTEM = `You are the Research Agent in an AI content newsroom. Your first job is planning Google News searches that surface the most important, most recent AI news.
${AUDIENCES}
Return JSON only: {"queries": ["...", "..."]}`;

const IDEA_SYSTEM = `You are the Research Agent in an AI content newsroom. You turn a batch of fresh news articles into content ideas.
${AUDIENCES}

Rules:
- Every idea must be grounded in at least one article from the provided list. Cite articles by their [number] in "sourceIds".
- Use only facts present in the articles. Never invent numbers, quotes, benchmarks or release details.
- Prioritize news that is recent, significant and relevant to people building software with AI (agents, models, developer tools, infrastructure, enterprise adoption, research with practical impact).
- Make the ideas diverse: do not give several ideas about the same story, and mix formats (news breakdown, explainer, practical how-to, contrarian take, trend analysis, comparison).
- Titles must be specific (name the company, model or product), not generic.
Return JSON only.`;

function formatArticles(articles) {
  return articles
    .map(
      (a) =>
        `[${a.n}] ${a.title} — ${a.source || 'unknown source'}${a.date ? ` (${a.date})` : ''}\n${(a.snippet || '').slice(0, 280)}`,
    )
    .join('\n\n');
}

// Round-robin merge so no single query dominates, then drop duplicate links/titles.
function mergeResults(resultLists) {
  const merged = [];
  const seenUrl = new Set();
  const seenTitle = new Set();
  const longest = Math.max(0, ...resultLists.map((l) => l.length));
  for (let i = 0; i < longest; i++) {
    for (const list of resultLists) {
      const a = list[i];
      if (!a) continue;
      const urlKey = a.url.split('?')[0];
      const titleKey = a.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (seenUrl.has(urlKey) || seenTitle.has(titleKey)) continue;
      seenUrl.add(urlKey);
      seenTitle.add(titleKey);
      merged.push(a);
    }
  }
  return merged.slice(0, MAX_ARTICLES).map((a, i) => ({ ...a, n: i + 1 }));
}

let ideaCounter = 0;

function normalizeIdeas(raw, articles) {
  const list = Array.isArray(raw?.ideas) ? raw.ideas : [];
  return list
    .filter((idea) => idea && idea.title)
    .map((idea) => {
      const ids = Array.isArray(idea.sourceIds) ? idea.sourceIds : [];
      const sources = [...new Set(ids.map(Number))]
        .map((n) => articles[n - 1])
        .filter(Boolean)
        .map(({ title, url, source, date }) => ({ title, url, source, date }));
      return {
        id: `idea-${++ideaCounter}`,
        title: String(idea.title),
        hook: String(idea.hook || ''),
        summary: String(idea.summary || ''),
        whyItMatters: String(idea.whyItMatters || ''),
        angle: String(idea.angle || ''),
        format: String(idea.format || ''),
        category: String(idea.category || ''),
        sources,
      };
    });
}

const IDEA_SHAPE = `{"ideas": [{
  "title": "specific headline-style title, max 12 words",
  "hook": "one scroll-stopping opening line",
  "summary": "2-3 sentences: what happened, with the key facts",
  "whyItMatters": "1-2 sentences on why builders and engineering leaders should care",
  "angle": "the specific take or storyline for the post",
  "format": "News breakdown | Explainer | How-to | Hot take | Trend analysis | Comparison",
  "category": "Models | Agents | Dev tools | Infrastructure | Enterprise | Research | Open source | Policy | Funding",
  "sourceIds": [1, 2]
}]}`;

export async function synthesizeIdeas({ settings, articles, focus, count = 10, keep = [], feedback = '' }) {
  const keepBlock = keep.length
    ? `\nThe editor is KEEPING these ideas (do not repeat or overlap with them):\n${keep
        .map((k, i) => `${i + 1}. ${k.title} — ${k.angle}`)
        .join('\n')}\n`
    : '';
  const feedbackBlock = feedback.trim() ? `\nEditor feedback to apply:\n"""${feedback.trim()}"""\n` : '';

  const user = `Today is ${todayISO()}.
${focus.trim() ? `Editorial focus requested by the editor: ${focus.trim()}\n` : ''}${keepBlock}${feedbackBlock}
Generate exactly ${count} content ideas from these articles:

${formatArticles(articles)}

Respond with JSON in this exact shape:
${IDEA_SHAPE}`;

  const raw = await chatJSON({ settings, system: IDEA_SYSTEM, user });
  const ideas = normalizeIdeas(raw, articles).slice(0, count);
  if (!ideas.length) throw new Error('The Research Agent did not return any ideas. Try again.');
  return ideas;
}

export async function runResearchAgent({ settings, focus = '', recency = 'qdr:w', log = () => {} }) {
  // Step 1 — plan queries
  log('Planning search queries…', 'think');
  let queries = [];
  try {
    const plan = await chatJSON({
      settings,
      system: PLANNER_SYSTEM,
      user: `Today is ${todayISO()}. We want news from ${RECENCY_LABEL[recency] || 'the past week'}.
${focus.trim() ? `Editorial focus: ${focus.trim()}\n` : 'No specific focus: cover the most important AI news overall, with an emphasis on agentic AI.\n'}
Write 6–8 short Google News search queries (2–5 words each, no quotes or operators). Cover different angles: major labs and model releases, AI agents, developer tools, open source, enterprise adoption, and funding/research.`,
    });
    queries = (plan.queries || []).filter((q) => typeof q === 'string' && q.trim()).map((q) => q.trim()).slice(0, 8);
  } catch (err) {
    // A bad key / model should stop the run; anything else falls back to default queries.
    if (/401|not found/i.test(err.message)) throw err;
    log(`Query planning failed (${err.message}). Using default queries.`, 'warn');
  }
  if (!queries.length) queries = DEFAULT_QUERIES;
  log(`Planned ${queries.length} searches.`, 'info');

  // Step 2 — search in parallel
  let firstError = null;
  const resultLists = await mapPool(queries, 4, async (query) => {
    log(`Searching Google News: “${query}”`, 'search');
    try {
      const results = await searchNews({ apiKey: settings.serpKey, query, recency });
      log(`${results.length} articles for “${query}”`, 'info');
      return results;
    } catch (err) {
      firstError ??= err;
      log(`Search failed for “${query}”: ${err.message}`, 'warn');
      return [];
    }
  });

  const articles = mergeResults(resultLists);
  if (!articles.length) {
    throw firstError || new Error('No news articles found. Try a broader focus or a longer time window.');
  }
  log(`Collected ${articles.length} unique articles. Synthesizing ideas…`, 'think');

  // Step 3 — synthesize ideas
  const ideas = await synthesizeIdeas({ settings, articles, focus });
  log(`Generated ${ideas.length} content ideas. Waiting for your review.`, 'done');
  return { queries, articles, ideas };
}
