import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { loadJsonObjectArtifact, loadJsonArrayArtifact } from '../../../src/shared/artifact-io/loaders/core.js';
import { readJsonLinesIterator } from '../../../src/shared/artifact-io/json.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
const root = resolveTestCachePath(process.cwd(), `strict-contained-${crypto.randomUUID()}`);
const indexDir = path.join(root, 'index');
const linked = path.join(indexDir, 'linked');
const originalLstat = fs.lstatSync;
const originalOpen = fs.openSync;
try {
  await fsPromises.mkdir(linked, { recursive: true });
  const target = path.join(linked, 'probe.json');
  await fsPromises.writeFile(target, '{"inside":true}');
  const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    pieces: [{ name: 'probe', path: 'linked/probe.json', format: 'json' }] };
  assert.deepEqual(await loadJsonObjectArtifact(indexDir, 'probe', { manifest, strict: true }), { inside: true });
  fs.lstatSync = (file, ...args) => {
    const stat = originalLstat(file, ...args);
    if (path.resolve(String(file)) === linked) return new Proxy(stat, {
      get(value, key) { return key === 'isSymbolicLink' ? () => true : Reflect.get(value, key); }
    });
    return stat;
  };
  await assert.rejects(loadJsonObjectArtifact(indexDir, 'probe', { manifest, strict: true }), { code: 'ERR_MANIFEST_PATH' });
  fs.lstatSync = originalLstat;
  const outside = path.join(root, 'outside.json');
  await fsPromises.writeFile(outside, '{"outside":true}');
  fs.openSync = (file, ...args) => originalOpen(path.resolve(String(file)) === target ? outside : file, ...args);
  await assert.rejects(loadJsonObjectArtifact(indexDir, 'probe', { manifest, strict: true }), { code: 'ERR_UNSAFE_FILE_PATH' });
  fs.openSync = originalOpen;
  const rows = path.join(indexDir, 'rows.jsonl');
  await fsPromises.writeFile(rows, '{"id":0}\n');
  const rowsManifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    pieces: [{ name: 'rows', path: 'rows.jsonl', format: 'jsonl', count: 1 }] };
  assert.deepEqual(await loadJsonArrayArtifact(indexDir, 'rows', { manifest: rowsManifest, strict: true }), [{ id: 0 }]);
  const streamed = [];
  for await (const row of readJsonLinesIterator(rows, { containedRoot: indexDir, byteRange: { start: 0, end: 9 } })) streamed.push(row);
  assert.deepEqual(streamed, [{ id: 0 }]);
} finally {
  fs.lstatSync = originalLstat;
  fs.openSync = originalOpen;
  await fsPromises.rm(root, { recursive: true, force: true });
}
console.log('strict descriptor-backed artifact reads passed');
