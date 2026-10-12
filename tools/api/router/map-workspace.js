import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const client = path.join(root, 'src/map/workspace');
const vendor = path.join(root, 'node_modules/reladraw/dist');
const files = new Set(['index.html', 'style.css', 'app.js', 'projection.js', 'reladraw.js', 'reladraw-worker.js', 'request.js', 'inspect.js', 'svg.js']);
/** Static application assets contain no repository data; origin guard runs first. Data routes retain authentication. */
export async function handleMapWorkspaceRoute(req, res, url, headers = {}) {
  if (req.method !== 'GET' || !(url.pathname === '/map/workspace' || url.pathname.startsWith('/map/workspace/') || url.pathname.startsWith('/map/vendor/reladraw/'))) return false;
  const vendorRequest = url.pathname.startsWith('/map/vendor/reladraw/');
  const name = url.pathname === '/map/workspace' || url.pathname === '/map/workspace/' ? 'index.html' : url.pathname.split('/').at(-1);
  const expected = vendorRequest ? `/map/vendor/reladraw/${name}` : `/map/workspace/${name}`;
  if ((url.pathname !== '/map/workspace' && url.pathname !== '/map/workspace/' && url.pathname !== expected)
    || (vendorRequest ? !/^[a-z][a-z0-9-]*\.js$/.test(name) : !files.has(name))) {
    res.writeHead(404, headers); res.end('Not found.'); return true;
  }
  try {
    const file = path.join(vendorRequest ? vendor : client, name);
    // Reject symlink escapes in dependency or client assets.
    const base = await fs.realpath(vendorRequest ? vendor : client), actual = await fs.realpath(file);
    if (!actual.startsWith(base + path.sep)) throw new Error('Asset outside root.');
    const bytes = await fs.readFile(actual);
    res.writeHead(200, { ...headers, 'Content-Type': name.endsWith('.html') ? 'text/html; charset=utf-8' : name.endsWith('.css') ? 'text/css' : 'text/javascript',
      'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
    res.end(bytes);
  } catch { res.writeHead(404, headers); res.end('Workspace asset unavailable. Run repository bootstrap.'); }
  return true;
}
