#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { applyTestEnv } from '../../helpers/test-env.js';
import { parseJavaScriptAst } from '../../../src/lang/javascript.js';
import { assignChunkUids } from '../../../src/index/identity/chunk-uid.js';
import { assignSegmentUids, chunkSegments, discoverSegments } from '../../../src/index/segments.js';
import { buildToolingVirtualDocuments } from '../../../src/index/tooling/vfs.js';

applyTestEnv();

const relPath = 'tests/fixtures/languages/src/javascript_component.jsx';
const absPath = path.join(process.cwd(), relPath);
const fileText = fs.readFileSync(absPath, 'utf8');

// Repro: when chunking JSX-derived "code" segments, reusing a full-container JS AST
// can yield out-of-segment chunk ranges, which later become invalid VFS virtualRanges.
const jsAst = parseJavaScriptAst(fileText, { ext: '.jsx' });
const context = { jsAst, treeSitter: null };

const segments = discoverSegments({
  text: fileText,
  ext: '.jsx',
  relPath,
  mode: 'code',
  languageId: 'javascript',
  context,
  segmentsConfig: null,
  extraSegments: []
});

await assignSegmentUids({ text: fileText, segments, ext: '.jsx', mode: 'code' });

const chunks = chunkSegments({
  text: fileText,
  ext: '.jsx',
  relPath,
  mode: 'code',
  context,
  segments
});

for (const chunk of chunks) {
  chunk.file = relPath;
  chunk.ext = '.jsx';
}

await assignChunkUids({ chunks, fileText, fileRelPath: relPath, strict: true });

const logs = [];
const { documents, targets } = await buildToolingVirtualDocuments({
  chunks,
  fileTextByPath: new Map([[relPath, fileText]]),
  strict: true,
  log: (line) => logs.push(String(line))
});

assert.ok(documents.length > 0, 'expected at least one virtual document');
assert.ok(targets.length > 0, 'expected at least one tooling target');
assert.equal(
  logs.some((line) => line.includes('Invalid virtualRange')),
  false,
  `unexpected invalid virtualRange logs:\n${logs.filter((line) => line.includes('Invalid virtualRange')).join('\n')}`
);

console.log('VFS invalid virtualRange regression test passed');

