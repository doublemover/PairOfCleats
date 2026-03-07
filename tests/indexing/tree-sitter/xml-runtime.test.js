#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  buildTreeSitterChunks,
  initTreeSitterRuntime,
  preloadTreeSitterLanguages,
  resetTreeSitterParser,
  resetTreeSitterStats,
  shutdownTreeSitterWorkerPool
} from '../../../src/lang/tree-sitter.js';
import { resolveTreeSitterLanguageForSegment } from '../../../src/index/build/file-processor/tree-sitter.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const timeout = setTimeout(() => {
  console.error('tree-sitter xml runtime test timed out');
  process.exit(1);
}, 20000);

const xmlText = `<config>
  <database host="localhost" port="5432">
    <pool size="5" />
  </database>
</config>
`;

try {
  resetTreeSitterStats();
  resetTreeSitterParser({ hard: true });
  assert.equal(
    resolveTreeSitterLanguageForSegment(null, '.xml'),
    'xml',
    'expected .xml to resolve to xml tree-sitter language'
  );

  const log = () => {};
  const ok = await initTreeSitterRuntime({ log });
  if (!ok) {
    console.log('tree-sitter runtime unavailable; skipping xml runtime test.');
    process.exit(0);
  }

  const preload = await preloadTreeSitterLanguages(['xml'], { log, parallel: false });
  assert.ok(
    preload.loaded.includes('xml'),
    `expected xml grammar preload; missing=${(preload.missing || []).join(',')} failures=${(preload.failures || []).join(',')}`
  );

  const chunks = buildTreeSitterChunks({
    text: xmlText,
    languageId: 'xml',
    ext: '.xml',
    options: {
      log,
      treeSitter: {
        enabled: true,
        strict: true,
        languages: { xml: true }
      }
    }
  });

  assert.ok(Array.isArray(chunks) && chunks.length > 0, 'expected xml tree-sitter chunks');
  const names = new Set(chunks.map((chunk) => chunk.name));
  const kinds = new Set(chunks.map((chunk) => chunk.kind));
  assert.ok(names.has('database'), 'expected database element chunk');
  assert.ok(
    Array.from(names).some((name) => name === 'database.host' || name === 'host'),
    'expected host attribute chunk'
  );
  assert.ok(kinds.has('ConfigSection'), 'expected config section chunk kind');
  assert.ok(kinds.has('ConfigEntry'), 'expected config entry chunk kind');

  console.log('tree-sitter xml runtime test passed');
} finally {
  clearTimeout(timeout);
  await shutdownTreeSitterWorkerPool();
}
