#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { startApiServer } from '../../helpers/api-server.js';
import {
  prepareSharedSearchContractFixture,
  SHARED_SEARCH_CONTRACT_CASES
} from '../../helpers/search-contract-cases.js';

const fixture = await prepareSharedSearchContractFixture({
  cacheName: 'api-search-contract-matrix'
});
const emptyRepo = path.join(fixture.workspaceRoot, 'empty-repo');
await fsPromises.mkdir(emptyRepo, { recursive: true });

const runSearchAndHealthCase = async () => {
  const { serverInfo, requestJson, requestRaw, stop } = await startApiServer({
    repoRoot: fixture.repoRoot,
    env: fixture.env,
    allowedRoots: [emptyRepo],
    maxBodyBytes: 512
  });
  try {
    for (const entry of SHARED_SEARCH_CONTRACT_CASES) {
      const response = await requestJson('POST', '/search', {
        query: entry.query,
        mode: entry.mode,
        top: entry.top
      }, serverInfo);
      if (response.status !== 200 || response.body?.ok !== true) {
        throw new Error(`api ${entry.id} expected ok response`);
      }
      entry.assertPayload(response.body?.result || {}, { source: 'api' });
    }

    const getWithMetaJsonAlias = await requestJson(
      'GET',
      `/search?q=return&mode=code&meta-json=${encodeURIComponent(JSON.stringify({ source: 'query-meta-alias' }))}`,
      null,
      serverInfo
    );
    if (getWithMetaJsonAlias.status !== 200 || getWithMetaJsonAlias.body?.ok !== true) {
      throw new Error('api search contract matrix should accept meta-json query param alias');
    }

    const invalid = await requestJson('POST', '/search', {}, serverInfo);
    if (invalid.status !== 400 || invalid.body?.ok !== false || invalid.body?.code !== 'INVALID_REQUEST') {
      throw new Error('api search contract matrix should reject missing query');
    }

    const missingContentType = await requestRaw(
      'POST',
      '/search',
      JSON.stringify({ query: 'return' }),
      serverInfo,
      { headers: {} }
    );
    if (missingContentType.status !== 415 || missingContentType.json?.code !== 'INVALID_REQUEST') {
      throw new Error('api search contract matrix should reject missing content-type');
    }

    const oversizedPayload = { query: 'return', extra: 'x'.repeat(600) };
    const tooLarge = await requestRaw(
      'POST',
      '/search',
      JSON.stringify(oversizedPayload),
      serverInfo,
      { headers: { 'Content-Type': 'application/json' } }
    );
    if (tooLarge.status !== 413 || tooLarge.json?.code !== 'INVALID_REQUEST') {
      throw new Error('api search contract matrix should enforce body size limits');
    }

    const unknownField = await requestJson('POST', '/search', {
      query: 'return',
      extraField: true
    }, serverInfo);
    if (unknownField.status !== 400 || unknownField.body?.code !== 'INVALID_REQUEST') {
      throw new Error('api search contract matrix should reject unknown fields');
    }

    const noIndex = await requestJson('POST', '/search', {
      repoPath: emptyRepo,
      query: 'return'
    }, serverInfo);
    if (noIndex.status !== 409 || noIndex.body?.code !== 'NO_INDEX') {
      throw new Error('api search contract matrix should return NO_INDEX for allowed roots without an index');
    }

    const unauthorized = await requestJson('GET', '/health', null, serverInfo, { auth: false });
    if (unauthorized.status !== 401 || unauthorized.body?.code !== 'UNAUTHORIZED') {
      throw new Error('api search contract matrix should reject missing auth');
    }

    const corsBlocked = await requestJson('GET', '/health', null, serverInfo, {
      headers: { Origin: 'https://example.com' }
    });
    if (corsBlocked.status !== 403 || corsBlocked.body?.code !== 'FORBIDDEN') {
      throw new Error('api search contract matrix should reject disallowed CORS origins');
    }

    const preflightBlocked = await requestJson('OPTIONS', '/health', null, serverInfo, {
      headers: {
        Origin: 'https://example.com',
        'Access-Control-Request-Method': 'GET'
      }
    });
    if (preflightBlocked.status !== 403 || preflightBlocked.body?.code !== 'FORBIDDEN') {
      throw new Error('api search contract matrix should reject disallowed CORS preflight');
    }

    const health = await requestJson('GET', '/health', null, serverInfo);
    if (!health.body?.ok || typeof health.body.uptimeMs !== 'number') {
      throw new Error('api search contract matrix /health response invalid');
    }

    const status = await requestJson('GET', '/status', null, serverInfo);
    if (!status.body?.ok || !status.body.status?.repo?.root) {
      throw new Error('api search contract matrix /status response missing repo info');
    }
    if (status.body?.status?.durability?.runtime?.degradedDurability !== false) {
      throw new Error('api search contract matrix /status response missing clean durability payload');
    }
    if (status.body?.trustBoundary?.effectiveBoundary?.summary !== serverInfo?.trustBoundary?.effectiveBoundary?.summary) {
      throw new Error('api search contract matrix /status response missing effective trust boundary summary');
    }
    if (typeof status.body?.trustBoundary?.repos?.allowedRepoRootCount !== 'number') {
      throw new Error('api search contract matrix /status response missing trust boundary counts');
    }
    const statusBody = JSON.stringify(status.body);
    if (statusBody.includes(fixture.repoRoot) || statusBody.includes(fixture.cacheRoot)) {
      throw new Error('api search contract matrix /status response leaked absolute paths');
    }
  } finally {
    await stop();
  }
};

const runCorsAllowCase = async () => {
  const origin = 'https://example.com';
  const { serverInfo, requestJson, stop } = await startApiServer({
    repoRoot: fixture.repoRoot,
    env: fixture.env,
    allowedRoots: [emptyRepo],
    corsAllowedOrigins: ['example.com']
  });
  try {
    const allowed = await requestJson('GET', '/health', null, serverInfo, {
      headers: { Origin: origin }
    });
    if (allowed.status !== 200) {
      throw new Error('api search contract matrix expected allowed origin to succeed');
    }
    const allowHeader = allowed.headers?.['access-control-allow-origin'];
    if (allowHeader !== origin) {
      throw new Error('api search contract matrix expected access-control-allow-origin header to match origin');
    }
  } finally {
    await stop();
  }
};

await runSearchAndHealthCase();
await runCorsAllowCase();

console.log('API search contract matrix test passed');
