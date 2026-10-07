#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { status } from '../../../src/integrations/core/index.js';
import { isAbsolutePathAny } from '../../../src/shared/file-paths.js';
import { createApiRouter } from '../../../tools/api/router.js';
import { redactAbsolutePaths, redactSearchResponseMetadata } from '../../../tools/api/redact.js';
import { parseSseEvents } from '../../helpers/api-server.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

// Inspect decoded values: JSON escaping can hide Windows paths from substring checks.
const assertNoAbsolutePaths = (value) => {
  if (typeof value === 'string') {
    assert.equal(isAbsolutePathAny(value), false, `absolute path exposed: ${value}`);
    if (value.startsWith('path:')) {
      assert.equal(isAbsolutePathAny(value.slice(5).trim()), false, 'absolute path reference exposed');
    }
  } else if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) assertNoAbsolutePaths(entry);
  }
};

const crossPlatform = {
  repo: { root: '/private/repo', cacheRoot: 'C:\\Users\\private\\cache' },
  overall: { cacheRoot: '\\\\server\\private\\cache' },
  nested: [{ ref: 'path:C:\\private\\index' }, { path: 'src/example.js' }],
  bytes: 42,
  healthy: true
};
const redacted = redactAbsolutePaths(crossPlatform);
assertNoAbsolutePaths(JSON.parse(JSON.stringify(redacted)));
assert.equal(redacted.nested[1].path, 'src/example.js');
assert.equal(redacted.bytes, 42);
assert.equal(redacted.healthy, true);
assert.equal(crossPlatform.repo.root, '/private/repo', 'redaction must not mutate local core output');

const searchResult = {
  query: '/absolute-looking user query',
  code: [{ text: '// source comment', snippet: '/private/path literal in source', file: 'src/example.js' }],
  observability: { context: { repoRoot: 'C:\\private\\repo', buildId: 'build-123' } },
  retrieval: { freshness: { activeGeneration: { activeBuildRoot: '/private/cache/build-123' } } }
};
const publicSearch = redactSearchResponseMetadata(searchResult);
assert.equal(publicSearch.query, searchResult.query, 'query content must remain intact');
assert.deepEqual(publicSearch.code, searchResult.code, 'source snippets and path literals must remain intact');
assert.equal(publicSearch.observability.context.buildId, 'build-123');
assertNoAbsolutePaths(publicSearch.observability);
assertNoAbsolutePaths(publicSearch.retrieval);
assert.equal(searchResult.observability.context.repoRoot, 'C:\\private\\repo');

const tempRoot = resolveTestCachePath(process.cwd(), 'api-status-path-redaction');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(repoRoot, { recursive: true });
await fs.mkdir(cacheRoot, { recursive: true });

await withTemporaryEnv({
  PAIROFCLEATS_TESTING: '1',
  PAIROFCLEATS_CACHE_ROOT: cacheRoot
}, async () => {
  const localStatus = await status(repoRoot);
  assert.equal(localStatus.repo.root, repoRoot, 'local core status must retain repository identity');
  const router = createApiRouter({
    host: '127.0.0.1',
    defaultRepo: repoRoot,
    defaultOutput: 'json',
    metricsRegistry: null
  });
  const server = http.createServer((req, res) => router.handleRequest(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${baseUrl}/status`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.status.repo.root, '<redacted:absolute-path>');
    assert.equal(body.status.repo.cacheRoot, '<redacted:absolute-path>');
    assert.equal(body.status.overall.cacheRoot, '<redacted:absolute-path>');
    assertNoAbsolutePaths(body.status);

    const stream = await fetch(`${baseUrl}/status/stream`);
    assert.equal(stream.status, 200);
    const events = parseSseEvents(await stream.text());
    const result = events.find((entry) => entry.event === 'result');
    assert.equal(result?.data?.ok, true);
    assert.equal(result.data.status.repo.root, '<redacted:absolute-path>');
    assertNoAbsolutePaths(result.data.status);
    assert.equal(events.find((entry) => entry.event === 'done')?.data?.ok, true);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    router.close();
  }
});

console.log('API status path redaction test passed');
