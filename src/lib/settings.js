// API keys and model settings, entered in the UI and kept in the browser only.
// "Remember" → localStorage (survives restarts); otherwise sessionStorage (cleared when the tab closes).
const STORAGE_KEY = 'newsroom.settings.v1';

export const DEFAULT_SETTINGS = {
  openaiKey: '',
  serpKey: '',
  model: 'gpt-6.1-sol',
  baseUrl: 'https://api.openai.com/v1',
  authorContext:
    'Satvik, founder of Build Fast with AI. Helps engineers and tech teams learn to build with generative and agentic AI.',
  remember: true,
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? sessionStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  const raw = JSON.stringify(settings);
  localStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(STORAGE_KEY);
  (settings.remember ? localStorage : sessionStorage).setItem(STORAGE_KEY, raw);
}

export function clearSettings() {
  localStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(STORAGE_KEY);
}

export const hasKeys = (s) => Boolean(s.openaiKey?.trim() && s.serpKey?.trim());
