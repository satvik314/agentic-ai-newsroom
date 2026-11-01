// LinkedIn Agent — one post per approved idea, written for senior technical
// professionals who are new to agentic AI. Optional CTA link goes below the post.
import { chatJSON } from '../lib/llm.js';
import { ideaBrief, revisionBlock } from './brief.js';

const SYSTEM = (authorContext) => `You are the LinkedIn Agent in an AI content newsroom. You ghostwrite LinkedIn posts in the author's voice.
${authorContext?.trim() ? `Author: ${authorContext.trim()}\n` : ''}
AUDIENCE
Senior technical professionals with 10–20 years of experience: architects, engineering managers, staff/principal engineers, CTOs and tech leads. They have deep fundamentals (distributed systems, APIs, databases, CI/CD, team leadership) but many have not worked hands-on with agentic AI yet.

HOW TO WRITE FOR THEM
- Approachable, never condescending. Respect their experience.
- Explain any agentic-AI term in plain words the first time it appears (e.g. "an agent: an LLM that can call tools in a loop until a task is done").
- Anchor new ideas in concepts they already know: microservices, workflow engines, job queues, cron, code review, onboarding a junior engineer, SLAs.
- Concrete over hype. Say what happened, why it matters for engineering teams, and one practical takeaway or question to consider.
- Banned: "game-changer", "revolutionize", "in today's fast-paced world", "unlock", "delve", "the future is here", clickbait, excessive exclamation marks.
- Only use facts supported by the sources. Do not invent numbers, quotes or claims.

FORMAT
- First 2 lines are the hook (under ~200 characters total) — they must make someone click "see more".
- Short paragraphs of 1–2 sentences with blank lines between them.
- Optionally one short list of 3–5 items using "→" or "•".
- End the body with a takeaway or a thoughtful question to invite comments.
- 900–1,600 characters for the body.
- Plain text only: no markdown (no **bold**, no # headings, no [links](...)). At most 2 emojis.
- Do NOT put URLs or hashtags inside the body.

Return JSON only.`;

export async function writeLinkedInPost({ settings, idea, cta = {}, editorNotes = '', extra = '', previous, instruction }) {
  const ctaUrl = cta.url?.trim();
  const ctaText = cta.text?.trim();
  const wantCta = Boolean(ctaUrl && !ctaText);

  const user = `${ideaBrief(idea, editorNotes)}
${extra.trim() ? `\nAdditional style instructions: ${extra.trim()}\n` : ''}${
    wantCta
      ? `\nA call-to-action link will be placed below the post: ${ctaUrl}\nWrite one short CTA line (max 15 words, no URL, no emoji) that naturally connects this post to that link.\n`
      : ''
  }${revisionBlock(previous, instruction)}

Respond with JSON:
{"post": "the full post body as plain text with \\n line breaks", ${wantCta ? '"cta": "the CTA line", ' : ''}"hashtags": ["#Tag1", "#Tag2", "#Tag3"]}`;

  const raw = await chatJSON({ settings, system: SYSTEM(settings.authorContext), user });
  const body = String(raw.post || '').trim();
  if (!body) throw new Error('The LinkedIn Agent returned an empty post.');

  const hashtags = (Array.isArray(raw.hashtags) ? raw.hashtags : [])
    .map((t) => String(t).trim().replace(/\s+/g, ''))
    .filter(Boolean)
    .map((t) => (t.startsWith('#') ? t : `#${t}`))
    .slice(0, 3);

  // The CTA is composed in code (not by the model) so the link is always exact.
  const ctaLine = ctaUrl ? ctaText || String(raw.cta || '').trim() || 'Learn more here:' : '';
  const parts = [body];
  if (hashtags.length) parts.push(hashtags.join(' '));
  if (ctaUrl) parts.push(`${ctaLine}\n👉 ${ctaUrl}`);

  return { text: parts.join('\n\n'), body, hashtags, ctaLine, ctaUrl: ctaUrl || '' };
}

// Runs the agent over all approved ideas in parallel; reports each result as it lands.
export function runLinkedInAgent({ settings, ideas, cta, editorNotes, extra, onUpdate }) {
  return Promise.all(
    ideas.map(async (idea) => {
      onUpdate(idea.id, { status: 'running' });
      try {
        const data = await writeLinkedInPost({ settings, idea, cta, editorNotes, extra });
        onUpdate(idea.id, { status: 'done', data });
      } catch (err) {
        onUpdate(idea.id, { status: 'error', error: err.message });
      }
    }),
  );
}
