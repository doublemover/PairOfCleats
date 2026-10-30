import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { enqueueEmbeddingJob } from '../../../src/index/build/indexer/embedding-queue.js';
import { prepareTestCacheDir } from '../../helpers/test-cache.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);
const { dir } = await prepareTestCacheDir('embedding-enqueue-cancellation');
const buildRoot = path.join(dir, 'build');
const indexDir = path.join(buildRoot, 'index-code');
await fs.mkdir(indexDir, { recursive: true });
const runtime = { embeddingService: true, embeddingQueue: { dir: path.join(dir, 'queue') },
  root: dir, buildRoot, buildId: 'fixture', argv: {}, useStubEmbeddings: true, embeddingMode: 'service', userConfig: {} };
let checks = 0;
const abortAfterDirectory = { get aborted() { return ++checks >= 2; } };
await assert.rejects(enqueueEmbeddingJob({ runtime, mode: 'code', indexDir, abortSignal: abortAfterDirectory }),
  { name: 'AbortError', code: 'ABORT_ERR' });
assert.ok(checks >= 2, 'abort must propagate from the post-await check inside the queue try/catch');
const preaborted = new AbortController();
preaborted.abort();
await assert.rejects(enqueueEmbeddingJob({ runtime, mode: 'code', indexDir, abortSignal: preaborted.signal }),
  { name: 'AbortError' });
console.log('Embedding enqueue propagates cancellation across directory admission');
