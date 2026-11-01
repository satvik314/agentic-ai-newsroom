import './style.css';
import { loadSettings, saveSettings, clearSettings, hasKeys, DEFAULT_SETTINGS } from './lib/settings.js';
import { escapeHtml as esc, tweetLength, copyText, downloadFile, todayISO } from './lib/util.js';
import { runResearchAgent, synthesizeIdeas } from './agents/researchAgent.js';
import { runLinkedInAgent, writeLinkedInPost } from './agents/linkedinAgent.js';
import { runTwitterAgent, writeThread, MIN_TWEETS, MAX_TWEETS } from './agents/twitterAgent.js';

const PICK = 3;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  settings: loadSettings(),
  draft: null, // settings being edited in the modal
  showKeys: false,
  stage: 'research', // research → review → create
  research: { status: 'idle', focus: '', recency: 'qdr:w', log: [], articles: [], ideas: [], error: '' },
  selected: [], // idea ids, in pick order
  feedback: '', // human notes: used to refine ideas and passed to the writers
  refining: false,
  reviewError: '',
  linkedin: { ctaUrl: '', ctaText: '', extra: '' },
  twitter: { defaultCount: 5, counts: {}, numbering: true, extra: '' },
  out: { linkedin: {}, twitter: {} }, // ideaId -> { status, data, error }
  revise: {}, // "agent:ideaId" -> instruction text
  writing: false,
  toast: '',
};

const app = document.querySelector('#app');
const ideaById = (id) => state.research.ideas.find((i) => i.id === id);
const selectedIdeas = () => state.selected.map(ideaById).filter(Boolean);
const hostname = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'source';
  }
};

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function render() {
  // Preserve focus & caret across re-renders (live agent updates re-render often).
  const active = document.activeElement;
  const focusId = active && app.contains(active) ? active.id : null;
  const sel = focusId && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;

  app.innerHTML = `
    ${Header()}
    <main class="container">
      ${Stepper()}
      ${ResearchPanel()}
      ${state.research.ideas.length ? ReviewPanel() : ''}
      ${state.stage === 'create' ? CreatePanel() : ''}
    </main>
    <footer class="footer">Keys stay in your browser and are only sent to OpenAI and SerpAPI (via the local /api/serp proxy).</footer>
    ${state.draft ? SettingsModal() : ''}
    ${state.toast ? `<div class="toast">${esc(state.toast)}</div>` : ''}
  `;

  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) {
      el.focus({ preventScroll: true });
      if (sel && el.setSelectionRange) {
        try {
          el.setSelectionRange(sel[0], sel[1]);
        } catch {
          /* number inputs don't support selection */
        }
      }
    }
  }
}

function Header() {
  const ready = hasKeys(state.settings);
  return `
  <header class="topbar">
    <div class="brand">
      <span class="brand-mark">◆</span>
      <div>
        <div class="brand-name">Agentic AI Newsroom</div>
        <div class="brand-sub">Research → Human review → LinkedIn + X, in parallel</div>
      </div>
    </div>
    <div class="topbar-right">
      <span class="model-pill" title="Model">${esc(state.settings.model)}</span>
      <button class="btn ghost" data-action="open-settings">
        <span class="dot ${ready ? 'ok' : 'warn'}"></span>${ready ? 'API keys' : 'Add API keys'}
      </button>
    </div>
  </header>`;
}

function Stepper() {
  const r = state.research.status;
  const steps = [
    { n: 1, label: 'Research Agent', sub: '10 ideas from the latest AI news', done: state.research.ideas.length > 0, active: state.stage === 'research' },
    { n: 2, label: 'Your review', sub: `Pick the top ${PICK}`, done: state.stage === 'create', active: state.stage === 'review' },
    { n: 3, label: 'LinkedIn + X Agents', sub: 'Run in parallel', done: state.stage === 'create' && !state.writing, active: state.stage === 'create' },
  ];
  return `<ol class="stepper">${steps
    .map(
      (s) => `<li class="${s.done ? 'done' : ''} ${s.active ? 'active' : ''} ${s.n === 1 && r === 'running' ? 'busy' : ''}">
        <span class="step-n">${s.done ? '✓' : s.n}</span>
        <span><strong>${s.label}</strong><small>${s.sub}</small></span>
      </li>`,
    )
    .join('')}</ol>`;
}

function ResearchPanel() {
  const r = state.research;
  const running = r.status === 'running';
  const collapsed = r.ideas.length && !running;
  return `
  <section class="panel">
    <div class="panel-head">
      <div>
        <span class="agent-tag research">Research Agent</span>
        <h2>Find what's worth talking about</h2>
      </div>
      ${r.status === 'done' ? `<span class="badge ok">${r.articles.length} articles scanned</span>` : ''}
    </div>
    <div class="row">
      <label class="field grow">
        <span>Focus <em>(optional)</em></span>
        <input id="focus" data-bind="research.focus" value="${esc(r.focus)}" ${running ? 'disabled' : ''}
          placeholder="e.g. coding agents, MCP, enterprise agent adoption, new model releases" />
      </label>
      <label class="field">
        <span>Time window</span>
        <select id="recency" data-bind="research.recency" ${running ? 'disabled' : ''}>
          ${[['qdr:d', 'Past 24 hours'], ['qdr:w', 'Past week'], ['qdr:m', 'Past month']]
            .map(([v, l]) => `<option value="${v}" ${r.recency === v ? 'selected' : ''}>${l}</option>`)
            .join('')}
        </select>
      </label>
      <button class="btn primary" data-action="run-research" ${running || state.writing ? 'disabled' : ''}>
        ${running ? '<span class="spinner"></span> Researching…' : r.ideas.length ? 'Re-run research' : 'Run Research Agent'}
      </button>
    </div>
    ${r.error ? `<div class="alert error">${esc(r.error)}</div>` : ''}
    ${
      r.log.length
        ? `<details class="log" ${collapsed ? '' : 'open'}>
            <summary>Agent activity (${r.log.length})</summary>
            <ul>${r.log
              .map((l) => `<li class="${l.kind}"><span class="log-icon"></span>${esc(l.msg)}</li>`)
              .join('')}${running ? '<li class="think pulse"><span class="log-icon"></span>Working…</li>' : ''}</ul>
          </details>`
        : ''
    }
  </section>`;
}

function IdeaCard(idea, idx) {
  const pickedAt = state.selected.indexOf(idea.id);
  const picked = pickedAt !== -1;
  const full = state.selected.length >= PICK;
  const locked = state.stage === 'create';
  return `
  <article class="idea ${picked ? 'picked' : ''} ${!picked && full ? 'dim' : ''}">
    <button class="pick" data-action="toggle-idea" data-id="${idea.id}" ${locked ? 'disabled' : ''}
      aria-pressed="${picked}" title="${picked ? 'Unselect' : 'Select'}">
      ${picked ? `<span class="pick-rank">#${pickedAt + 1}</span>` : '<span class="pick-plus">+</span>'}
    </button>
    <div class="idea-meta">
      <span class="idea-num">${String(idx + 1).padStart(2, '0')}</span>
      ${idea.category ? `<span class="chip">${esc(idea.category)}</span>` : ''}
      ${idea.format ? `<span class="chip soft">${esc(idea.format)}</span>` : ''}
    </div>
    <h3>${esc(idea.title)}</h3>
    ${idea.hook ? `<p class="hook">“${esc(idea.hook)}”</p>` : ''}
    <p>${esc(idea.summary)}</p>
    ${idea.whyItMatters ? `<p class="why"><strong>Why it matters:</strong> ${esc(idea.whyItMatters)}</p>` : ''}
    ${idea.angle ? `<p class="angle"><strong>Angle:</strong> ${esc(idea.angle)}</p>` : ''}
    ${
      idea.sources.length
        ? `<div class="sources">${idea.sources
            .map(
              (s) =>
                `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" title="${esc(s.title)}">${esc(s.source || hostname(s.url))}${s.date ? ` · ${esc(s.date)}` : ''}</a>`,
            )
            .join('')}</div>`
        : ''
    }
  </article>`;
}

function ReviewPanel() {
  const ideas = state.research.ideas;
  const n = state.selected.length;
  const locked = state.stage === 'create';
  const busy = state.refining || state.research.status === 'running';
  return `
  <section class="panel">
    <div class="panel-head">
      <div>
        <span class="agent-tag human">Human in the loop</span>
        <h2>Pick your top ${PICK} ideas</h2>
      </div>
      <span class="badge ${n === PICK ? 'ok' : ''}">${n}/${PICK} selected</span>
    </div>

    <div class="ideas">${ideas.map(IdeaCard).join('')}</div>

    ${
      locked
        ? `<div class="locked-note">Approved. <button class="link" data-action="edit-selection" ${state.writing ? 'disabled' : ''}>Change selection or settings</button></div>`
        : `
    <div class="review-grid">
      <div class="card">
        <h4>Feedback for the agents</h4>
        <p class="hint">Used to refine the idea list, and passed to both writers as editor notes.</p>
        <textarea id="feedback" data-bind="feedback" rows="4" placeholder="e.g. More on open-source models. Skip funding news. Make one idea a practical how-to.">${esc(state.feedback)}</textarea>
        <button class="btn" data-action="refine" ${busy ? 'disabled' : ''}>
          ${state.refining ? '<span class="spinner dark"></span> Refining…' : n ? `Keep ${n} picked, regenerate the rest` : 'Regenerate ideas with feedback'}
        </button>
        ${state.reviewError ? `<div class="alert error">${esc(state.reviewError)}</div>` : ''}
      </div>

      <div class="card">
        <h4><span class="agent-tag linkedin">LinkedIn</span> CTA link</h4>
        <p class="hint">Added below every post. Leave empty for no CTA.</p>
        <label class="field"><span>CTA link</span>
          <input id="cta-url" type="url" data-bind="linkedin.ctaUrl" value="${esc(state.linkedin.ctaUrl)}" placeholder="https://buildfastwithai.com/..." /></label>
        <label class="field"><span>CTA text <em>(optional — otherwise the agent writes one)</em></span>
          <input id="cta-text" data-bind="linkedin.ctaText" value="${esc(state.linkedin.ctaText)}" placeholder="Join our Agentic AI cohort:" /></label>
        <label class="field"><span>Extra style notes <em>(optional)</em></span>
          <input id="li-extra" data-bind="linkedin.extra" value="${esc(state.linkedin.extra)}" placeholder="e.g. Share a personal opinion in the closing line" /></label>
      </div>

      <div class="card">
        <h4><span class="agent-tag x">X</span> Thread length</h4>
        <p class="hint">Choose how many tweets each thread should have.</p>
        <div class="row tight">
          <label class="field"><span>Default</span>
            <input id="tw-default" type="number" min="${MIN_TWEETS}" max="${MAX_TWEETS}" data-bind="twitter.defaultCount" value="${state.twitter.defaultCount}" /></label>
          <button class="btn small" data-action="apply-default-count">Apply to all</button>
        </div>
        ${
          n
            ? `<ul class="count-list">${selectedIdeas()
                .map(
                  (i, k) => `<li><span class="rank">#${k + 1}</span><span class="t">${esc(i.title)}</span>
                    <input id="count-${i.id}" type="number" min="${MIN_TWEETS}" max="${MAX_TWEETS}" data-count-for="${i.id}"
                      value="${state.twitter.counts[i.id] ?? state.twitter.defaultCount}" aria-label="Tweets for ${esc(i.title)}" /> tweets</li>`,
                )
                .join('')}</ul>`
            : '<p class="hint muted">Select ideas to set a count per thread.</p>'
        }
        <label class="check"><input id="tw-num" type="checkbox" data-bind="twitter.numbering" ${state.twitter.numbering ? 'checked' : ''}/> Number tweets (1/5, 2/5…)</label>
        <label class="field"><span>Extra style notes <em>(optional)</em></span>
          <input id="tw-extra" data-bind="twitter.extra" value="${esc(state.twitter.extra)}" placeholder="e.g. Include one code-level detail" /></label>
      </div>
    </div>

    <div class="approve-bar">
      <span>${n === PICK ? 'Ready. Both agents will run in parallel.' : `Select ${PICK - n} more idea${PICK - n === 1 ? '' : 's'}.`}</span>
      <button class="btn primary big" data-action="approve" ${n === PICK && !busy ? '' : 'disabled'}>
        Approve & run LinkedIn + X Agents →
      </button>
    </div>`
    }
  </section>`;
}

function statusBadge(status) {
  if (status === 'running') return '<span class="badge run"><span class="spinner dark"></span> Writing</span>';
  if (status === 'done') return '<span class="badge ok">Done</span>';
  if (status === 'error') return '<span class="badge err">Error</span>';
  return '';
}

function ReviseBar(agent, id, running) {
  const key = `${agent}:${id}`;
  return `<div class="revise">
    <input id="revise-${agent}-${id}" data-revise="${key}" value="${esc(state.revise[key] || '')}" placeholder="Ask for changes (optional): shorter, punchier hook, add an analogy…" ${running ? 'disabled' : ''}/>
    <button class="btn small" data-action="regenerate" data-agent="${agent}" data-id="${id}" ${running ? 'disabled' : ''}>↻ Regenerate</button>
  </div>`;
}

function LinkedInOutput(idea, k) {
  const o = state.out.linkedin[idea.id] || {};
  const running = o.status === 'running';
  return `
  <article class="out-card">
    <header><span class="rank">#${k + 1}</span><h4>${esc(idea.title)}</h4>${statusBadge(o.status)}</header>
    ${o.error ? `<div class="alert error">${esc(o.error)}</div>` : ''}
    ${
      o.data
        ? `<div class="li-post ${running ? 'stale' : ''}">${esc(o.data.text)}</div>
           <div class="out-actions">
             <span class="muted">${o.data.text.length.toLocaleString()} characters</span>
             <button class="btn small" data-action="copy" data-agent="linkedin" data-id="${idea.id}">Copy post</button>
           </div>`
        : running
          ? '<div class="skeleton"></div>'
          : ''
    }
    ${o.status && o.status !== 'running' ? ReviseBar('linkedin', idea.id, running) : ''}
  </article>`;
}

function XOutput(idea, k) {
  const o = state.out.twitter[idea.id] || {};
  const running = o.status === 'running';
  const tweets = o.data?.tweets || [];
  return `
  <article class="out-card">
    <header><span class="rank">#${k + 1}</span><h4>${esc(idea.title)}</h4>${statusBadge(o.status)}</header>
    ${o.error ? `<div class="alert error">${esc(o.error)}</div>` : ''}
    ${
      o.data
        ? `${o.data.warnings?.length ? `<div class="alert warn">${o.data.warnings.map(esc).join('<br/>')}</div>` : ''}
           <ol class="thread ${running ? 'stale' : ''}">${tweets
             .map((t, i) => {
               const len = tweetLength(t);
               return `<li class="tweet">
                 <div class="tweet-text">${esc(t)}</div>
                 <div class="tweet-foot">
                   <span class="count ${len > 280 ? 'over' : len > 260 ? 'near' : ''}">${len}/280</span>
                   <button class="link" data-action="copy-tweet" data-id="${idea.id}" data-index="${i}">Copy</button>
                 </div>
               </li>`;
             })
             .join('')}</ol>
           <div class="out-actions">
             <span class="muted">${tweets.length} tweet${tweets.length === 1 ? '' : 's'}</span>
             <button class="btn small" data-action="copy" data-agent="twitter" data-id="${idea.id}">Copy thread</button>
           </div>`
        : running
          ? '<div class="skeleton"></div>'
          : ''
    }
    ${
      o.status && o.status !== 'running'
        ? `<div class="row tight regen-count"><label>Tweets <input id="recount-${idea.id}" type="number" min="${MIN_TWEETS}" max="${MAX_TWEETS}" data-count-for="${idea.id}" value="${state.twitter.counts[idea.id] ?? state.twitter.defaultCount}"/></label></div>${ReviseBar('twitter', idea.id, running)}`
        : ''
    }
  </article>`;
}

function CreatePanel() {
  const ideas = selectedIdeas();
  const allDone = (agent) => ideas.every((i) => state.out[agent][i.id]?.status === 'done');
  const anyRunning = (agent) => ideas.some((i) => state.out[agent][i.id]?.status === 'running');
  const agentStatus = (agent) => (anyRunning(agent) ? 'running' : allDone(agent) ? 'done' : ideas.some((i) => state.out[agent][i.id]?.status === 'error') ? 'error' : '');
  return `
  <section class="panel">
    <div class="panel-head">
      <div>
        <span class="agent-tag writers">Writer Agents</span>
        <h2>Your content</h2>
      </div>
      <div class="row tight">
        <button class="btn small" data-action="export" ${state.writing ? 'disabled' : ''}>Download .md</button>
      </div>
    </div>
    <div class="columns">
      <div class="column">
        <div class="column-head linkedin"><span class="agent-tag linkedin">LinkedIn Agent</span>${statusBadge(agentStatus('linkedin'))}
          <small>Senior engineers & tech leaders, new to agentic AI</small></div>
        ${ideas.map(LinkedInOutput).join('')}
      </div>
      <div class="column">
        <div class="column-head x"><span class="agent-tag x">X Agent</span>${statusBadge(agentStatus('twitter'))}
          <small>Startup developers in SF & the Bay Area</small></div>
        ${ideas.map(XOutput).join('')}
      </div>
    </div>
  </section>`;
}

function SettingsModal() {
  const d = state.draft;
  const type = state.showKeys ? 'text' : 'password';
  return `
  <div class="modal-backdrop" data-action="close-settings-backdrop">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div class="panel-head"><h2 id="settings-title">API keys & model</h2>
        <button class="icon-btn" data-action="close-settings" aria-label="Close">✕</button></div>
      <label class="field"><span>OpenAI API key</span>
        <input id="s-openai" type="${type}" data-draft="openaiKey" value="${esc(d.openaiKey)}" placeholder="sk-..." autocomplete="off" spellcheck="false" /></label>
      <label class="field"><span>SerpAPI key</span>
        <input id="s-serp" type="${type}" data-draft="serpKey" value="${esc(d.serpKey)}" placeholder="Your serpapi.com key" autocomplete="off" spellcheck="false" /></label>
      <label class="check"><input id="s-show" type="checkbox" data-action="toggle-show" ${state.showKeys ? 'checked' : ''}/> Show keys</label>
      <div class="row">
        <label class="field grow"><span>Model</span>
          <input id="s-model" data-draft="model" value="${esc(d.model)}" spellcheck="false" /></label>
        <label class="field grow"><span>OpenAI base URL</span>
          <input id="s-base" data-draft="baseUrl" value="${esc(d.baseUrl)}" spellcheck="false" /></label>
      </div>
      <label class="field"><span>Author voice <em>(who the posts are written as)</em></span>
        <textarea id="s-author" data-draft="authorContext" rows="2">${esc(d.authorContext)}</textarea></label>
      <label class="check"><input id="s-remember" type="checkbox" data-draft="remember" ${d.remember ? 'checked' : ''}/> Remember on this device (localStorage). Unchecked = cleared when the tab closes.</label>
      <p class="hint">Keys are stored only in this browser. OpenAI is called directly; SerpAPI requests go through this app's <code>/api/serp</code> proxy because SerpAPI blocks browser calls.</p>
      <div class="modal-actions">
        <button class="btn ghost danger" data-action="clear-settings">Clear saved keys</button>
        <span class="grow"></span>
        <button class="btn" data-action="close-settings">Cancel</button>
        <button class="btn primary" data-action="save-settings">Save</button>
      </div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
let toastTimer;
function toast(msg) {
  state.toast = msg;
  render();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    state.toast = '';
    render();
  }, 1800);
}

function requireKeys() {
  if (hasKeys(state.settings)) return true;
  openSettings();
  return false;
}

function openSettings() {
  state.draft = { ...state.settings };
  render();
  setTimeout(() => document.getElementById(state.draft.openaiKey ? 's-serp' : 's-openai')?.focus(), 0);
}

function clampCount(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(MAX_TWEETS, Math.max(MIN_TWEETS, n)) : state.twitter.defaultCount;
}

async function runResearch() {
  if (!requireKeys()) return;
  const r = state.research;
  Object.assign(r, { status: 'running', log: [], articles: [], ideas: [], error: '' });
  Object.assign(state, { stage: 'research', selected: [], reviewError: '', out: { linkedin: {}, twitter: {} }, revise: {} });
  render();
  try {
    const result = await runResearchAgent({
      settings: state.settings,
      focus: r.focus,
      recency: r.recency,
      log: (msg, kind = 'info') => {
        r.log.push({ msg, kind });
        render();
      },
    });
    Object.assign(r, { articles: result.articles, ideas: result.ideas, status: 'done' });
    state.stage = 'review';
  } catch (err) {
    r.status = 'error';
    r.error = err.message;
    r.log.push({ msg: err.message, kind: 'error' });
  }
  render();
  if (state.stage === 'review') document.querySelector('.ideas')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function refineIdeas() {
  if (!requireKeys()) return;
  const keep = selectedIdeas();
  state.refining = true;
  state.reviewError = '';
  render();
  try {
    const fresh = await synthesizeIdeas({
      settings: state.settings,
      articles: state.research.articles,
      focus: state.research.focus,
      count: 10 - keep.length,
      keep,
      feedback: state.feedback,
    });
    state.research.ideas = [...keep, ...fresh];
    state.research.log.push({ msg: `Refined ideas with your feedback (kept ${keep.length}, generated ${fresh.length}).`, kind: 'done' });
  } catch (err) {
    state.reviewError = err.message;
  }
  state.refining = false;
  render();
}

async function approve() {
  if (!requireKeys() || state.selected.length !== PICK) return;
  const ideas = selectedIdeas();
  ideas.forEach((i) => (state.twitter.counts[i.id] = clampCount(state.twitter.counts[i.id] ?? state.twitter.defaultCount)));
  state.stage = 'create';
  state.writing = true;
  state.out = { linkedin: {}, twitter: {} };
  render();
  document.querySelector('.columns')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const update = (agent) => (id, patch) => {
    state.out[agent][id] = { ...state.out[agent][id], ...patch, ...(patch.status === 'running' ? { error: '' } : {}) };
    render();
  };

  // The two writer agents run simultaneously, each handling all 3 ideas in parallel.
  await Promise.all([
    runLinkedInAgent({
      settings: state.settings,
      ideas,
      cta: { url: state.linkedin.ctaUrl, text: state.linkedin.ctaText },
      editorNotes: state.feedback,
      extra: state.linkedin.extra,
      onUpdate: update('linkedin'),
    }),
    runTwitterAgent({
      settings: state.settings,
      ideas,
      counts: state.twitter.counts,
      numbering: state.twitter.numbering,
      editorNotes: state.feedback,
      extra: state.twitter.extra,
      onUpdate: update('twitter'),
    }),
  ]);
  state.writing = false;
  render();
}

async function regenerate(agent, id) {
  if (!requireKeys()) return;
  const idea = ideaById(id);
  const slot = state.out[agent][id] || {};
  const instruction = state.revise[`${agent}:${id}`] || '';
  state.out[agent][id] = { ...slot, status: 'running', error: '' };
  render();
  try {
    let data;
    if (agent === 'linkedin') {
      data = await writeLinkedInPost({
        settings: state.settings,
        idea,
        cta: { url: state.linkedin.ctaUrl, text: state.linkedin.ctaText },
        editorNotes: state.feedback,
        extra: state.linkedin.extra,
        previous: slot.data?.body,
        instruction,
      });
    } else {
      const count = clampCount(state.twitter.counts[id] ?? state.twitter.defaultCount);
      state.twitter.counts[id] = count;
      data = await writeThread({
        settings: state.settings,
        idea,
        count,
        numbering: state.twitter.numbering,
        editorNotes: state.feedback,
        extra: state.twitter.extra,
        previous: slot.data ? slot.data.tweets.join('\n---\n') : undefined,
        instruction,
      });
    }
    state.out[agent][id] = { status: 'done', data };
    state.revise[`${agent}:${id}`] = '';
  } catch (err) {
    state.out[agent][id] = { ...slot, status: 'error', error: err.message };
  }
  render();
}

function exportMarkdown() {
  const lines = [`# AI content pack — ${todayISO()}`, ''];
  selectedIdeas().forEach((idea, k) => {
    lines.push(`## ${k + 1}. ${idea.title}`, '', `> ${idea.summary}`, '');
    if (idea.sources.length) lines.push('Sources:', ...idea.sources.map((s) => `- [${s.title}](${s.url})`), '');
    const li = state.out.linkedin[idea.id]?.data;
    lines.push('### LinkedIn', '', li ? li.text : '_Not generated_', '');
    const tw = state.out.twitter[idea.id]?.data;
    lines.push('### X thread', '', tw ? tw.tweets.map((t) => `${t}\n`).join('\n') : '_Not generated_', '');
  });
  downloadFile(`ai-content-${todayISO()}.md`, lines.join('\n'));
}

function setPath(path, value) {
  const keys = path.split('.');
  let obj = state;
  while (keys.length > 1) obj = obj[keys.shift()];
  obj[keys[0]] = value;
}

// ---------------------------------------------------------------------------
// Events (delegated)
// ---------------------------------------------------------------------------
app.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const { action, id, agent } = el.dataset;

  switch (action) {
    case 'open-settings':
      return openSettings();
    case 'close-settings':
      state.draft = null;
      return render();
    case 'close-settings-backdrop':
      if (e.target === el) {
        state.draft = null;
        render();
      }
      return;
    case 'toggle-show':
      state.showKeys = el.checked;
      return render();
    case 'save-settings': {
      const d = state.draft;
      state.settings = {
        ...d,
        openaiKey: d.openaiKey.trim(),
        serpKey: d.serpKey.trim(),
        model: d.model.trim() || DEFAULT_SETTINGS.model,
        baseUrl: d.baseUrl.trim() || DEFAULT_SETTINGS.baseUrl,
      };
      saveSettings(state.settings);
      state.draft = null;
      return toast(hasKeys(state.settings) ? 'Settings saved' : 'Saved — both keys are needed to run');
    }
    case 'clear-settings':
      clearSettings();
      state.settings = { ...DEFAULT_SETTINGS };
      state.draft = { ...DEFAULT_SETTINGS };
      return toast('Saved keys cleared');
    case 'run-research':
      return runResearch();
    case 'toggle-idea': {
      const i = state.selected.indexOf(id);
      if (i !== -1) state.selected.splice(i, 1);
      else if (state.selected.length < PICK) state.selected.push(id);
      else return toast(`You can pick ${PICK}. Unselect one first.`);
      return render();
    }
    case 'apply-default-count':
      state.twitter.defaultCount = clampCount(state.twitter.defaultCount);
      state.selected.forEach((sid) => (state.twitter.counts[sid] = state.twitter.defaultCount));
      return render();
    case 'refine':
      return refineIdeas();
    case 'approve':
      return approve();
    case 'edit-selection':
      state.stage = 'review';
      render();
      return document.querySelector('.ideas')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    case 'regenerate':
      return regenerate(agent, id);
    case 'copy': {
      const data = state.out[agent][id]?.data;
      if (!data) return;
      const text = agent === 'linkedin' ? data.text : data.tweets.join('\n\n');
      return toast((await copyText(text)) ? 'Copied to clipboard' : 'Copy failed');
    }
    case 'copy-tweet': {
      const tweet = state.out.twitter[id]?.data?.tweets[Number(el.dataset.index)];
      if (tweet) toast((await copyText(tweet)) ? 'Tweet copied' : 'Copy failed');
      return;
    }
    case 'export':
      return exportMarkdown();
  }
});

// Inputs update state without re-rendering (keeps typing smooth).
app.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.bind && el.type !== 'checkbox') {
    const numeric = el.type === 'number';
    setPath(el.dataset.bind, numeric ? Number(el.value) : el.value);
  } else if (el.dataset.draft && el.type !== 'checkbox') {
    state.draft[el.dataset.draft] = el.value;
  } else if (el.dataset.countFor) {
    state.twitter.counts[el.dataset.countFor] = Number(el.value);
  } else if (el.dataset.revise) {
    state.revise[el.dataset.revise] = el.value;
  }
});

app.addEventListener('change', (e) => {
  const el = e.target;
  if (el.type === 'checkbox' && el.dataset.bind) setPath(el.dataset.bind, el.checked);
  else if (el.type === 'checkbox' && el.dataset.draft) state.draft[el.dataset.draft] = el.checked;
  else if (el.tagName === 'SELECT' && el.dataset.bind) setPath(el.dataset.bind, el.value);
  else if (el.dataset.countFor) {
    state.twitter.counts[el.dataset.countFor] = clampCount(el.value);
    el.value = state.twitter.counts[el.dataset.countFor];
  } else if (el.dataset.bind === 'twitter.defaultCount') {
    state.twitter.defaultCount = clampCount(el.value);
    el.value = state.twitter.defaultCount;
  }
});

app.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.draft) {
    state.draft = null;
    render();
  }
  if (e.key === 'Enter' && e.target.id === 'focus' && state.research.status !== 'running') runResearch();
  if (e.key === 'Enter' && e.target.dataset.revise) {
    const [agent, id] = e.target.dataset.revise.split(':');
    if (state.out[agent][id]?.status !== 'running') regenerate(agent, id);
  }
});

render();
if (!hasKeys(state.settings)) openSettings();
