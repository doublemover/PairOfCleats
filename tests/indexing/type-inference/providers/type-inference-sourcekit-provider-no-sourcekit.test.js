#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createSourcekitProvider } from '../../../../src/index/tooling/sourcekit-provider.js';

import { resolveTestCachePath } from '../../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'sourcekit-provider-no-sourcekit');
const repoRoot = path.join(tempRoot, 'repo');
const srcDir = path.join(repoRoot, 'src');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(srcDir, { recursive: true });
await fs.writeFile(
  path.join(srcDir, 'sample.swift'),
  'func greet(name: String) -> String { return "hi" }\n'
);

const docText = 'func greet(name: String) -> String { return "hi" }\n';
const virtualPath = '.poc-vfs/src/sample.swift#seg:stub.swift';
const documents = [{
  virtualPath,
  text: docText,
  languageId: 'swift',
  effectiveExt: '.swift'
}];
const targets = [{
  chunkRef: {
    docId: 0,
    chunkUid: 'ck64:v1:test:src/sample.swift:deadbeef',
    chunkId: 'chunk_deadbeef',
    file: 'src/sample.swift',
    segmentUid: null,
    segmentId: null,
    range: { start: 0, end: docText.length }
  },
  virtualPath,
  virtualRange: { start: 0, end: docText.length },
  symbolHint: { name: 'greet', kind: 'function' }
}];

const logs = [];
const log = (evt) => {
  if (!evt) return;
  logs.push(typeof evt === 'string' ? evt : (evt.message || String(evt)));
};

const provider = createSourcekitProvider();
const originalPath = process.env.PATH;
process.env.PATH = '';
let result = null;
try {
  result = await provider.run({
    repoRoot,
    buildRoot: repoRoot,
    toolingConfig: {},
    strict: true,
    logger: log
  }, { documents, targets });
} finally {
  process.env.PATH = originalPath;
}

if (!result || !result.byChunkUid || typeof result.byChunkUid !== 'object') {
  console.error('sourcekit provider did not return a byChunkUid map.');
  process.exit(1);
}

if (Object.keys(result.byChunkUid).length !== 0) {
  console.error('sourcekit provider should return empty map when sourcekit-lsp is missing.');
  process.exit(1);
}

if (!logs.some((entry) => entry.includes('sourcekit-lsp not detected'))) {
  console.error('sourcekit provider missing expected fallback log message.');
  process.exit(1);
}

console.log('sourcekit provider fallback test passed');
