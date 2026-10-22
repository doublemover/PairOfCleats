import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { init, parse } from 'es-module-lexer';
import { resolveMapViewerAsset } from './map-viewer-assets.js';
import { contentTypeForMapIsoPath } from './map-iso-static.js';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

/** Retain one bounded immutable local module closure for this listener. */
export const pinMapViewerAssets = async (toolRoot, threeUrl = '/three/three.module.js', { signal = null } = {}) => {
  await init;
  const origin = 'http://127.0.0.1';
  const three = new URL(threeUrl, origin);
  if (three.origin !== origin || !resolveMapViewerAsset(toolRoot, three.pathname)) throw new Error('Preview --three-url must resolve to a supported local asset route.');
  const queue = [{ route: '/isomap/viewer.js', required: true },
    ...[three.pathname, '/three/examples/jsm/lines/LineSegments2.js', '/three/examples/jsm/lines/LineSegmentsGeometry.js',
      '/three/examples/jsm/lines/LineMaterial.js', '/three/examples/jsm/loaders/RGBELoader.js',
      '/assets/isomap/normal.jpg', '/assets/isomap/moonless_golf_2k.hdr'].map(route => ({ route, required: false }))];
  const assets = new Map(), seen = new Set(), unavailable = [];
  let totalBytes = 0;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    signal?.throwIfAborted();
    const { route, required } = queue[cursor];
    if (seen.has(route)) continue;
    seen.add(route);
    if (seen.size > 256) throw new Error('Viewer session exceeds its 256-asset admission budget.');
    const filePath = resolveMapViewerAsset(toolRoot, route);
    if (!filePath) throw new Error(`Viewer dependency has no safe local route: ${route}`);
    let bytes;
    try {
      const handle = await fs.open(filePath, 'r');
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error('Asset is not a bounded regular file.');
        const chunks = []; let size = 0;
        for await (const chunk of handle.createReadStream({ autoClose: false, signal })) {
          size += chunk.length;
          if (size > 8 * 1024 * 1024) throw new Error('Asset exceeded its admission budget while reading.');
          chunks.push(chunk);
        }
        bytes = Buffer.concat(chunks, size);
      } finally { await handle.close(); }
    } catch (error) {
      if (required) throw new Error(`Required local viewer asset unavailable: ${route}: ${error.message}`);
      unavailable.push({ route, reason: error.message });
      continue;
    }
    totalBytes += bytes.length;
    if (totalBytes > 32 * 1024 * 1024) throw new Error('Viewer session assets exceed the 32 MiB admission budget.');
    assets.set(route, { bytes, sha256: digest(bytes), contentType: contentTypeForMapIsoPath(route) });
    if (!route.endsWith('.js')) continue;
    const [dependencies] = parse(bytes.toString('utf8'));
    for (const dependency of dependencies) {
      if (!dependency.n) continue;
      const specifier = dependency.n === 'three' ? three.pathname : dependency.n;
      if (!specifier.startsWith('.') && !specifier.startsWith('/')) throw new Error(`Unmapped local viewer dependency: ${specifier}`);
      const resolved = new URL(specifier, `${origin}${route}`);
      if (resolved.origin !== origin) throw new Error('Viewer session does not admit remote module fallback.');
      queue.push({ route: resolved.pathname, required });
    }
  }
  const identity = digest(JSON.stringify([...assets].map(([route, value]) => [route, value.sha256]).sort()));
  return { assets, identity, totalBytes, unavailable };
};
