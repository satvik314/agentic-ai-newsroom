# agentic-ai-newsroom

A team of AI agents that researches the latest AI news and turns it into LinkedIn posts and X/Twitter threads, with a human approval step in the middle. Built with Vite (vanilla JS).

```
 Research Agent ──► You pick the top 3 ──► ┌─ LinkedIn Agent ─┐  (run in parallel)
 (SerpAPI + LLM)    (+ feedback)           └─ X Agent ────────┘
```

## The agents

| Agent | What it does |
| --- | --- |
| **Research Agent** (`src/agents/researchAgent.js`) | Plans 6–8 Google News queries, runs them in parallel with SerpAPI, removes duplicate articles, then writes **10 content ideas**. Each idea cites the articles it is based on, and those links are mapped back to the real search results. |
| **Human review** | You pick **exactly 3** ideas. You can also give feedback and click "Keep picked, regenerate the rest" to replace the ideas you didn't pick. |
| **LinkedIn Agent** (`src/agents/linkedinAgent.js`) | Writes one post per idea for senior technical readers (10–20 years of experience) who are new to agentic AI. It explains jargon and uses analogies to things they already know. If you enter a **CTA link**, it goes below every post; if you leave it empty, the post has no CTA. |
| **X Agent** (`src/agents/twitterAgent.js`) | Writes one thread per idea for developers at SF/Bay Area startups. You set the **number of tweets per thread**. It checks the tweet count and the 280-character limit (URLs count as 23) and fixes its own output once if either is wrong. |

After you approve, the LinkedIn and X agents run at the same time. Each one handles its 3 ideas in parallel, so all 6 drafts are written concurrently. You can regenerate any draft with an instruction like "shorter, punchier hook", copy posts or threads, or download everything as Markdown.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173 and click **API keys** to enter:

- **OpenAI API key**
- **SerpAPI key**
- **Model**: defaults to `gpt-6.1-sol` and can be changed. You can also change the OpenAI base URL.
- **Author voice**: who the posts are written as.

Keys are stored only in your browser. "Remember" uses `localStorage`; if you turn it off, keys go in `sessionStorage` and are cleared when the tab closes.

## Why there's a proxy

SerpAPI blocks direct browser requests (CORS), so the app calls `/api/serp`:

- `npm run dev` and `npm run preview` forward it to `serpapi.com` (see `vite.config.js`).
- **Deploying:** `api/serp.js` is a ready-made serverless function (it works as-is on Vercel). On other hosts, forward `/api/serp?<query>` to `https://serpapi.com/search.json?<query>`.

OpenAI is called directly from the browser.

## Project layout

```
src/
  main.js               UI, state, orchestration (research → review → parallel writers)
  style.css
  agents/
    researchAgent.js    query planning, search, idea synthesis/refinement
    linkedinAgent.js    LinkedIn writer + CTA composition
    twitterAgent.js     thread writer + length/count validation
    brief.js            shared idea brief for the writer agents
  lib/
    llm.js              OpenAI chat-completions client (JSON mode)
    serp.js             SerpAPI Google News client
    settings.js         API keys/model stored in the browser
    util.js             helpers (escaping, tweet length, concurrency pool…)
api/serp.js             serverless SerpAPI proxy for production
```
