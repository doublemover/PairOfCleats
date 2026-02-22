#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { ensureFixtureIndex } from '../../helpers/fixture-index.js';
import { startApiServer } from '../../helpers/api-server.js';

const cacheName = 'api-search-happy';
const cacheRoot = path.join(process.cwd(), 'tests', '.cache', cacheName);
await fsPromises.rm(cacheRoot, { recursive: true, force: true });

const { fixtureRoot, env } = await ensureFixtureIndex({
  fixtureName: 'sample',
  cacheName,
  cacheScope: 'shared'
});

const { serverInfo, requestJson, stop } = await startApiServer({
  repoRoot: fixtureRoot,
  allowedRoots: [],
  env
});

try {
  const search = await requestJson('POST', '/search', { query: 'return', mode: 'code', top: 3 }, serverInfo);
  const hits = search.body?.result?.code || [];
  if (!search.body?.ok || !hits.length) {
    throw new Error('api-server /search returned no results');
  }
  if (hits[0]?.tokens !== undefined) {
    throw new Error('api-server /search should default to compact JSON output');
  }

  const getWithMeta = await requestJson(
    'GET',
    `/search?q=return&mode=code&meta=kind=function&meta=lang=js&metaJson=${encodeURIComponent(JSON.stringify({ source: 'query-meta' }))}`,
    null,
    serverInfo
  );
  if (getWithMeta.status !== 200 || getWithMeta.body?.ok !== true) {
    throw new Error('api-server GET /search should accept meta/metaJson query params');
  }

  const getWithMetaJsonAlias = await requestJson(
    'GET',
    `/search?q=return&mode=code&meta-json=${encodeURIComponent(JSON.stringify({ source: 'query-meta-alias' }))}`,
    null,
    serverInfo
  );
  if (getWithMetaJsonAlias.status !== 200 || getWithMetaJsonAlias.body?.ok !== true) {
    throw new Error('api-server GET /search should accept meta-json query param alias');
  }
} catch (err) {
  console.error(err?.message || err);
  process.exit(1);
} finally {
  await stop();
}

console.log('API search happy path ok.');
