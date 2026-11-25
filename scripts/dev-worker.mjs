// Runs the data proxy (the Cloudflare Worker) on your own machine, with no online account and no extra packages.
//   npm run worker:dev            then it listens on http://localhost:8787
//   PORT=9000 npm run worker:dev
// It runs the very same code that is deployed (worker/aircraft-proxy.mjs), against the real providers, with the
// answers cached in memory. Local pages (http://localhost:<any port>) are always allowed to read it.
//   ALLOWED_ORIGINS=https://example.com npm run worker:dev    also allow another origin
//   ENABLED=false npm run worker:dev                          start with the kill switch on (every path answers 503)
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { handle } from '../worker/aircraft-proxy.mjs';

// The little in-memory stand-in for Cloudflare's cache: the Worker only needs match() and put().
function memoryCache() {
  const m = new Map();
  return {
    match: async (req) => (m.has(req.url) ? m.get(req.url).clone() : undefined),
    put: async (req, res) => { m.set(req.url, res.clone()); },
  };
}

export function startDevWorker({ port = Number(process.env.PORT) || 8787, env = { ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || '', ENABLED: process.env.ENABLED }, fetchImpl, quiet = false } = {}) {
  const cache = memoryCache();
  const server = http.createServer(async (req, res) => {
    try {
      const request = new Request('http://localhost:' + port + req.url, { method: req.method, headers: req.headers });
      const response = await handle(request, env, { cache, ...(fetchImpl ? { fetchImpl } : {}) });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      if (!quiet) console.log(req.method, req.url, response.status, response.headers.get('x-provider') || '', response.headers.get('x-cache') || '');
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('dev worker error: ' + e.message);
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await startDevWorker();
  console.log('FarGems data proxy on http://localhost:' + server.address().port);
  console.log('Try: http://localhost:' + server.address().port + '/aircraft?lat=47.6&lon=-122.3');
  console.log('Point the app at it: in config.js use  aircraftProxy: \'http://localhost:' + server.address().port + '/aircraft\'');
}
