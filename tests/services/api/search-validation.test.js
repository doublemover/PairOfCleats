#!/usr/bin/env node
import { prepareFixtureApiServerCohort } from '../../helpers/api-server.js';

const cohort = await prepareFixtureApiServerCohort({
  cacheName: 'api-search-validation'
});
const { serverInfo, requestJson, requestRaw, stop } = await cohort.start({
  allowedRoots: [],
  maxBodyBytes: 512
});

try {
  const invalid = await requestJson('POST', '/search', {}, serverInfo);
  if (invalid.status !== 400 || invalid.body?.ok !== false || invalid.body?.code !== 'INVALID_REQUEST') {
    throw new Error('api-server should reject missing query');
  }

  const missingContentType = await requestRaw(
    'POST',
    '/search',
    JSON.stringify({ query: 'return' }),
    serverInfo,
    { headers: {} }
  );
  if (missingContentType.status !== 415 || missingContentType.json?.code !== 'INVALID_REQUEST') {
    throw new Error('api-server should reject missing content-type');
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
    throw new Error('api-server should enforce body size limits');
  }

  const unknownField = await requestJson('POST', '/search', {
    query: 'return',
    extraField: true
  }, serverInfo);
  if (unknownField.status !== 400 || unknownField.body?.code !== 'INVALID_REQUEST') {
    throw new Error('api-server should reject unknown fields');
  }
} catch (err) {
  console.error(err?.message || err);
  process.exit(1);
} finally {
  await stop();
}

console.log('API search validation ok.');
