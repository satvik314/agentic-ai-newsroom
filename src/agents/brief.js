// Shared brief given to the writer agents for one approved idea.
export function ideaBrief(idea, editorNotes = '') {
  const sources = idea.sources.length
    ? idea.sources
        .map((s, i) => `${i + 1}. ${s.title} — ${s.source || 'source'}${s.date ? ` (${s.date})` : ''}\n   ${s.url}`)
        .join('\n')
    : '(no sources attached)';

  return `IDEA: ${idea.title}
Format: ${idea.format || 'n/a'} | Category: ${idea.category || 'n/a'}
Suggested hook: ${idea.hook}
What happened: ${idea.summary}
Why it matters: ${idea.whyItMatters}
Angle: ${idea.angle}

Sources (use only facts supported here):
${sources}${editorNotes.trim() ? `\n\nEditor notes (follow these):\n"""${editorNotes.trim()}"""` : ''}`;
}

export function revisionBlock(previous, instruction) {
  if (!previous) return '';
  return `\n\nREVISION REQUEST
Your previous draft:
"""
${previous}
"""
Change requested by the editor: ${instruction?.trim() || 'Write a fresh, stronger version with a different hook.'}`;
}
