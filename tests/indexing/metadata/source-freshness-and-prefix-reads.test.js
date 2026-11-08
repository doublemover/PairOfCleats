import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { sourceEntryIsFresh } from '../../../src/index/build/incremental/source-freshness.js';
import { createPreCpuArtifactState } from '../../../src/index/build/file-processor/pre-cpu-state.js';
import { detectShebangLanguage } from '../../../src/index/build/shebang.js';
import { readFileSample } from '../../../src/index/build/file-scan.js';
import { createRecordsClassifier, shouldSniffRecordContent } from '../../../src/index/build/records.js';
import { correlateAuthorizedCode } from '../../../src/integrations/inference-history/correlation.js';
import { prepareTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareTestCacheDir('source-freshness-prefix-reads');
const originalOpen = fs.open;
let forceEof = false;
try {
  const root = await fs.realpath(dir);
  const source = path.join(root, 'a.js');
  await fs.writeFile(source, 'const A = 1;');
  await fs.utimes(source, 1000.123, 1000.123);
  const stat = await fs.stat(source);
  const entry = { size: stat.size, mtimeMs: stat.mtimeMs, hash: createHash('sha1').update('const A = 1;').digest('hex') };
  assert.equal(await sourceEntryIsFresh({ absPath: source, stat, entry }), true);
  await fs.writeFile(source, 'const B = 2;');
  await fs.utimes(source, stat.atime, stat.mtime);
  const changed = await fs.stat(source);
  assert.equal(changed.size, entry.size);
  assert.equal(await sourceEntryIsFresh({ absPath: source, stat: changed, entry }), false);
  const legacy = createPreCpuArtifactState({ fileTextCache: new Map([['a.js', 'old text']]), relKey: 'a.js', fileStat: changed });
  assert.equal(legacy.text, null, 'unversioned text is not freshness evidence');
  const shell = path.join(root, 'script');
  const notes = path.join(root, 'notes.md');
  await fs.writeFile(shell, '#!/usr/bin/env bash\necho ok\n');
  await fs.writeFile(notes, 'heading\nTEST-123\n');
  fs.open = async (...args) => {
    const handle = await originalOpen(...args);
    const read = handle.read.bind(handle);
    handle.read = (buffer, offset, length, position) => forceEof
      ? Promise.resolve({ bytesRead: 0, buffer }) : read(buffer, offset, Math.min(length, 1), position);
    return handle;
  };
  assert.deepEqual(await detectShebangLanguage(shell), { languageId: 'shell', ext: '.sh' });
  assert.equal((await readFileSample(notes, 256)).toString('utf8'), 'heading\nTEST-123\n');
  const access = { policyEpoch: 'fixture', repositories: [{ repositoryId: 'repo', root, markdownPaths: ['notes.md'] }] };
  const correlation = await correlateAuthorizedCode('TEST-123', access);
  assert.equal(correlation.relations[0]?.line, 2);
  forceEof = true;
  await assert.rejects(correlateAuthorizedCode('TEST-123', access), { code: 'ERR_INFERENCE_HISTORY_INCOMPLETE_READ' });
  assert.equal(shouldSniffRecordContent('.txt'), true);
  assert.equal(shouldSniffRecordContent('.md'), false);
  const classifier = createRecordsClassifier({ root, config: { enabled: true } });
  assert.equal(classifier.classify({ relPath: 'incident.txt', ext: '.txt', sampleText: 'FATAL: incident\n' })?.recordType, 'stack');
} finally { fs.open = originalOpen; await fs.rm(dir, { recursive: true, force: true }); }
console.log('source freshness and bounded prefix reads test passed');
