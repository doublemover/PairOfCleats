#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { readJsonFile, readJsonLinesArraySync } from '../../../src/shared/artifact-io.js';
import { writeJsonLinesFile } from '../../../src/shared/json-stream.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'artifact-bak-recovery');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });

const primaryPath = path.join(tempRoot, 'primary.json');
const primaryBak = `${primaryPath}.bak`;
await fsPromises.writeFile(primaryPath, JSON.stringify({ ok: true }));
await fsPromises.writeFile(primaryBak, JSON.stringify({ ok: false }));

const expectThrow = (label, fn) => {
  try {
    fn();
  } catch {
    return;
  }
  console.error(`artifact bak test failed: expected error for ${label}.`);
  process.exit(1);
};

const primary = readJsonFile(primaryPath);
if (!primary?.ok) {
  console.error('artifact bak test failed: primary read did not return expected payload.');
  process.exit(1);
}
if (fs.existsSync(primaryBak)) {
  console.error('artifact bak test failed: backup was not cleaned up after primary read.');
  process.exit(1);
}

const corruptPath = path.join(tempRoot, 'corrupt.json');
const corruptBak = `${corruptPath}.bak`;
await fsPromises.writeFile(corruptPath, '{bad json');
await fsPromises.writeFile(corruptBak, JSON.stringify({ ok: 'backup' }));

const fallback = readJsonFile(corruptPath);
if (fallback?.ok !== 'backup') {
  console.error('artifact bak test failed: fallback did not return backup payload.');
  process.exit(1);
}
if (!fs.existsSync(corruptBak)) {
  console.error('artifact bak test failed: backup should remain after fallback read.');
  process.exit(1);
}

const missingPath = path.join(tempRoot, 'missing.json');
const missingBak = `${missingPath}.bak`;
await fsPromises.writeFile(missingBak, JSON.stringify({ ok: 'onlybak' }));
const missing = readJsonFile(missingPath);
if (missing?.ok !== 'onlybak') {
  console.error('artifact bak test failed: missing primary did not fall back to backup.');
  process.exit(1);
}
if (!fs.existsSync(missingBak)) {
  console.error('artifact bak test failed: backup should remain when primary is missing.');
  process.exit(1);
}

const jsonlPath = path.join(tempRoot, 'lines.jsonl');
const jsonlBak = `${jsonlPath}.bak`;
await writeJsonLinesFile(jsonlPath, [{ id: 1 }, { id: 2 }], { atomic: false });
await fsPromises.writeFile(jsonlBak, '{"id":3}\n');
const jsonl = readJsonLinesArraySync(jsonlPath);
if (jsonl.length !== 2) {
  console.error('artifact bak test failed: jsonl primary read did not return expected rows.');
  process.exit(1);
}
if (fs.existsSync(jsonlBak)) {
  console.error('artifact bak test failed: jsonl backup was not cleaned up after primary read.');
  process.exit(1);
}

const jsonlCorruptPath = path.join(tempRoot, 'lines-corrupt.jsonl');
const jsonlCorruptBak = `${jsonlCorruptPath}.bak`;
await fsPromises.writeFile(jsonlCorruptPath, '{bad\n');
await fsPromises.writeFile(jsonlCorruptBak, '{"id":4}\n{"id":5}\n');
const jsonlFallback = readJsonLinesArraySync(jsonlCorruptPath);
if (jsonlFallback.length !== 2) {
  console.error('artifact bak test failed: jsonl backup fallback did not return expected rows.');
  process.exit(1);
}
if (!fs.existsSync(jsonlCorruptBak)) {
  console.error('artifact bak test failed: jsonl backup should remain after fallback read.');
  process.exit(1);
}

const gzPath = path.join(tempRoot, 'compressed.json');
const gzSidecar = `${gzPath}.gz`;
const gzSidecarBak = `${gzSidecar}.bak`;
await fsPromises.writeFile(gzSidecar, gzipSync(JSON.stringify({ ok: 'gz' })));
await fsPromises.writeFile(gzSidecarBak, gzipSync(JSON.stringify({ ok: 'gz-bak' })));
const gzPayload = readJsonFile(gzPath);
if (gzPayload?.ok !== 'gz') {
  console.error('artifact bak test failed: gzip sidecar did not load.');
  process.exit(1);
}
if (fs.existsSync(gzSidecarBak)) {
  console.error('artifact bak test failed: gzip backup was not cleaned up after read.');
  process.exit(1);
}

const gzCorruptPath = path.join(tempRoot, 'compressed-corrupt.json');
const gzCorruptSidecar = `${gzCorruptPath}.gz`;
const gzCorruptBak = `${gzCorruptSidecar}.bak`;
await fsPromises.writeFile(gzCorruptSidecar, gzipSync('{bad'));
await fsPromises.writeFile(gzCorruptBak, gzipSync(JSON.stringify({ ok: 'gz-fallback' })));
const gzFallback = readJsonFile(gzCorruptPath);
if (gzFallback?.ok !== 'gz-fallback') {
  console.error('artifact bak test failed: gzip backup fallback did not load.');
  process.exit(1);
}
if (!fs.existsSync(gzCorruptBak)) {
  console.error('artifact bak test failed: gzip backup should remain after fallback read.');
  process.exit(1);
}

const doubleCorruptPath = path.join(tempRoot, 'double-corrupt.json');
const doubleCorruptBak = `${doubleCorruptPath}.bak`;
await fsPromises.writeFile(doubleCorruptPath, '{bad json');
await fsPromises.writeFile(doubleCorruptBak, '{bad backup');
expectThrow('corrupt primary and backup', () => readJsonFile(doubleCorruptPath));
if (!fs.existsSync(doubleCorruptBak)) {
  console.error('artifact bak test failed: corrupt backup should remain after failed read.');
  process.exit(1);
}

console.log('artifact bak recovery tests passed');

