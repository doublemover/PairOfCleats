#!/usr/bin/env node
import { startApiServer } from '../../helpers/api-server.js';
import {
  prepareSharedSearchContractFixture,
  SHARED_SEARCH_CONTRACT_CASES
} from '../../helpers/search-contract-cases.js';

const fixture = await prepareSharedSearchContractFixture({
  cacheName: 'api-search-contract-matrix'
});

const { serverInfo, requestJson, stop } = await startApiServer({
  repoRoot: fixture.repoRoot,
  env: fixture.env,
  allowedRoots: []
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
} finally {
  await stop();
}

console.log('API search contract matrix test passed');
