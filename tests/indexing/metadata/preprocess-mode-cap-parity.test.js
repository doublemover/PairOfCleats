import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import ignore from 'ignore';
import { preprocessFiles } from '../../../src/index/build/preprocess.js';
import { resolveFileCaps, resolveSharedDiscoveryFileCaps } from '../../../src/index/build/file-processor/read.js';
import { prepareTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareTestCacheDir('preprocess-mode-cap-parity');
try {
  const text = Array.from({ length: 200 }, (_, index) => `const value${index} = ${index};`).join('\n');
  await fs.writeFile(path.join(dir, 'a.js'), text);
  const fileCaps = { default: { maxBytes: 100, maxLines: 100 }, byMode: { code: { maxBytes: 10000, maxLines: 1000 } } };
  assert.deepEqual(resolveFileCaps(fileCaps, '.js', 'javascript', 'code'), { maxBytes: 10000, maxLines: 1000 });
  assert.equal(resolveSharedDiscoveryFileCaps(fileCaps, '.js', 'javascript', ['code', 'prose']).maxBytes, 10000);
  const controller = new AbortController();
  const result = await preprocessFiles({ root: dir, modes: ['code'], fileCaps, ignoreMatcher: ignore(),
    maxFileBytes: 20000, fileScan: { binary: { enabled: false }, minified: { enabled: false } },
    concurrency: 1, abortSignal: controller.signal });
  assert.equal(result.entriesByMode.code.length, 1, 'early discovery and line-count gates honor mode authority');
  assert.equal(result.entriesByMode.code[0].lines, 200);
  const onlyModeCaps = await preprocessFiles({ root: dir, modes: ['code'], fileCaps: { byMode: { code: { maxLines: 100 } } },
    ignoreMatcher: ignore(), concurrency: 1, abortSignal: controller.signal });
  assert.equal(onlyModeCaps.entriesByMode.code.length, 0, 'by-mode-only line limits still request counts');
  assert.ok(onlyModeCaps.skippedByMode.code.some(skip => skip.reason === 'oversize' && skip.lines === 200));
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('preprocessing mode cap parity test passed');
