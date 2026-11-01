// X/Twitter Agent — one thread per approved idea, with a user-chosen tweet count,
// written for developers at Bay Area tech startups.
import { chatJSON } from '../lib/llm.js';
import { tweetLength } from '../lib/util.js';
import { ideaBrief, revisionBlock } from './brief.js';

export const MIN_TWEETS = 1;
export const MAX_TWEETS = 20;
const TWEET_LIMIT = 280;

const SYSTEM = (authorContext) => `You are the X/Twitter Agent in an AI content newsroom. You ghostwrite threads in the author's voice.
${authorContext?.trim() ? `Author: ${authorContext.trim()}\n` : ''}
AUDIENCE
Developers and engineers at tech startups in San Francisco and the Bay Area. They ship fast, use LLM APIs daily, read Hacker News, and are allergic to hype and engagement bait.

HOW TO WRITE FOR THEM
- Tweet 1 is the hook: a concrete piece of news plus why a builder should care. It must stand alone in the feed.
- One idea per tweet. Dense, specific, conversational. Name the model, API, repo, price, benchmark or limit when the sources support it.
- Cover: what shipped, how it works, how to try it today, tradeoffs/gotchas, and your opinionated take.
- Final tweet: the sharp takeaway, plus the most relevant source URL from the brief (URLs count as 23 characters).
- Banned: "game-changer", "revolutionary", "buckle up", "let that sink in", "🧵👇" style bait, more than one hashtag in the whole thread, emoji spam.
- Only use facts supported by the sources. Do not invent numbers or quotes.

Return JSON only.`;

function validate(tweets, count, limit) {
  const problems = [];
  if (tweets.length !== count) problems.push(`The thread must have exactly ${count} tweets; you returned ${tweets.length}.`);
  tweets.forEach((t, i) => {
    const len = tweetLength(t);
    if (len > limit) problems.push(`Tweet ${i + 1} is ${len} characters; the limit is ${limit}.`);
  });
  return problems;
}

export async function writeThread({ settings, idea, count, numbering = true, editorNotes = '', extra = '', previous, instruction }) {
  const n = Math.min(MAX_TWEETS, Math.max(MIN_TWEETS, Number(count) || 5));
  const useNumbers = numbering && n > 1;
  // Reserve room for the "1/5 " prefix that is added in code.
  const limit = useNumbers ? TWEET_LIMIT - `${n}/${n} `.length : TWEET_LIMIT;

  const baseUser = `${ideaBrief(idea, editorNotes)}
${extra.trim() ? `\nAdditional style instructions: ${extra.trim()}\n` : ''}
Write ${n === 1 ? 'a single standalone tweet' : `a thread of EXACTLY ${n} tweets`}.
Each tweet must be at most ${limit} characters${useNumbers ? ' (do NOT number the tweets; numbering is added automatically)' : ''}.${revisionBlock(previous, instruction)}

Respond with JSON: {"tweets": ["tweet 1", "tweet 2", ...]}`;

  let user = baseUser;
  let tweets = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await chatJSON({ settings, system: SYSTEM(settings.authorContext), user });
    tweets = (Array.isArray(raw.tweets) ? raw.tweets : [])
      .map((t) => String(typeof t === 'string' ? t : t?.text ?? '').trim())
      .map((t, i) => t.replace(new RegExp(`^${i + 1}\\s*/\\s*(${n})?\\s+`), '')) // strip "1/5 " if the model numbered anyway
      .filter(Boolean);
    const problems = validate(tweets, n, limit);
    if (!problems.length) break;
    // One self-correction pass with concrete feedback.
    user = `${baseUser}

Your previous attempt had problems:
${problems.map((p) => `- ${p}`).join('\n')}
Previous attempt: ${JSON.stringify({ tweets })}
Fix them and return the corrected JSON.`;
  }

  if (!tweets.length) throw new Error('The X Agent returned an empty thread.');
  if (tweets.length > n) tweets = tweets.slice(0, n);

  const finalTweets = useNumbers ? tweets.map((t, i) => `${i + 1}/${tweets.length} ${t}`) : tweets;
  const warnings = validate(finalTweets, n, TWEET_LIMIT);
  return { tweets: finalTweets, requested: n, warnings };
}

// Runs the agent over all approved ideas in parallel; reports each result as it lands.
export function runTwitterAgent({ settings, ideas, counts, numbering, editorNotes, extra, onUpdate }) {
  return Promise.all(
    ideas.map(async (idea) => {
      onUpdate(idea.id, { status: 'running' });
      try {
        const data = await writeThread({ settings, idea, count: counts[idea.id], numbering, editorNotes, extra });
        onUpdate(idea.id, { status: 'done', data });
      } catch (err) {
        onUpdate(idea.id, { status: 'error', error: err.message });
      }
    }),
  );
}
