import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { init, parse } from 'es-module-lexer/minimal';
import { resolveMapViewerAsset } from '../../analysis/map-viewer-assets.js';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

const readBoundedResponse = async (response, maximum) => {
  const chunks = []; let bytes = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maximum) throw new Error('Viewer HTML exceeds smoke byte bound.');
      chunks.push(Buffer.from(next.value));
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  return Buffer.concat(chunks, bytes).toString('utf8');
};

/** Listener/asset smoke only. This does not claim rendered frames or FPS. */
export const verifyMapViewerModuleGraph = async ({ url, toolRoot, fetchImpl = fetch }) => {
  await init();
  const origin = new URL(url).origin;
  const signal = AbortSignal.timeout(5000);
  const htmlResponse = await fetchImpl(url, { signal });
  if (!htmlResponse.ok) throw new Error(`Viewer HTML HTTP ${htmlResponse.status}`);
  const html = await readBoundedResponse(htmlResponse, 32 * 1024 * 1024);
  const imports = {};
  for (const match of html.matchAll(/<script\b[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/gi)) Object.assign(imports, JSON.parse(match[1]).imports);
  const queue = [...html.matchAll(/<script\b[^>]*type=["']module["'][^>]*src=["']([^"']+)["']/gi)].map(match => new URL(match[1], url).href);
  if (!queue.length) throw new Error('Viewer entry module missing.');
  // Runtime-selected Three helpers are explicit dependencies, beyond static imports.
  for (const label of [imports.three, '/three/examples/jsm/lines/LineSegments2.js',
    '/three/examples/jsm/lines/LineSegmentsGeometry.js', '/three/examples/jsm/lines/LineMaterial.js']) {
    if (label) queue.push(new URL(label, url).href);
  }
  const seen = new Set(), receipts = [];
  let totalBytes = 0;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const moduleUrl = new URL(queue[cursor]);
    if (moduleUrl.origin !== origin) throw new Error('Viewer module graph cannot fall back to an external origin.');
    if (seen.has(moduleUrl.href)) continue;
    seen.add(moduleUrl.href);
    if (seen.size > 256) throw new Error('Viewer module graph exceeds bounded smoke inventory.');
    const expectedPath = resolveMapViewerAsset(toolRoot, decodeURIComponent(moduleUrl.pathname));
    if (!expectedPath) throw new Error(`Viewer dependency has no safe route: ${moduleUrl.pathname}`);
    const response = await fetchImpl(moduleUrl.href, { signal });
    if (!response.ok || !/javascript/i.test(response.headers.get('content-type') || '')) throw new Error(`Viewer module unavailable or wrong MIME: ${moduleUrl.pathname} (${response.status})`);
    const declaredLength = Number(response.headers.get('content-length'));
    if (declaredLength > 4 * 1024 * 1024) throw new Error('Viewer module exceeds smoke byte bound.');
    const reader = response.body.getReader();
    const chunks = []; let bytes = 0;
    try {
      while (true) {
        const next = await reader.read(); if (next.done) break;
        bytes += next.value.byteLength; totalBytes += next.value.byteLength;
        if (bytes > 4 * 1024 * 1024 || totalBytes > 16 * 1024 * 1024) throw new Error('Viewer graph exceeds smoke byte bound.');
        chunks.push(Buffer.from(next.value));
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
    const source = Buffer.concat(chunks, bytes);
    const expectedStat = await fs.stat(expectedPath);
    if (!expectedStat.isFile() || expectedStat.size > 4 * 1024 * 1024) throw new Error('Viewer expected asset exceeds smoke byte bound.');
    const expected = await fs.readFile(expectedPath);
    if (digest(source) !== digest(expected)) throw new Error(`Viewer asset identity mismatch: ${moduleUrl.pathname}`);
    receipts.push({ url: moduleUrl.href, bytes, sha256: digest(source) });
    const [dependencies] = parse(source.toString('utf8'));
    for (const dependency of dependencies) {
      if (!dependency.n) continue; // Computed imports use the explicit runtime inventory above.
      const resolved = imports[dependency.n] || dependency.n;
      if (!resolved.startsWith('.') && !resolved.startsWith('/') && !/^https?:/.test(resolved)) throw new Error(`Unmapped viewer module ${resolved}`);
      queue.push(new URL(resolved, moduleUrl).href);
    }
  }
  return { status: 'module-graph-ready', modules: receipts, totalBytes,
    renderedViewer: 'not-run', fps: 'not-measured' };
};
