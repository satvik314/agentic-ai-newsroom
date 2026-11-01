import { defineConfig } from 'vite';

// SerpAPI does not allow direct browser (CORS) requests, so the app calls
// /api/serp and Vite forwards it to serpapi.com. The same proxy is used by
// `vite preview`. For production hosting, see api/serp.js (serverless).
const serpProxy = {
  '/api/serp': {
    target: 'https://serpapi.com',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/serp/, '/search.json'),
  },
};

export default defineConfig({
  server: { proxy: serpProxy },
  preview: { proxy: serpProxy },
});
