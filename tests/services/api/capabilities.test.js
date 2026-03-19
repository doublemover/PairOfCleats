#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { MCP_SCHEMA_VERSION } from '../../../src/integrations/mcp/defs.js';
import { getCapabilities } from '../../../src/shared/capabilities.js';
import { getApiWorkflowCapabilities, getRuntimeCapabilityManifest } from '../../../src/shared/runtime-capability-manifest.js';
import { getToolVersion } from '../../../tools/shared/dict-utils.js';
import { ensureFixtureIndex } from '../../helpers/fixture-index.js';
import { startApiServer } from '../../helpers/api-server.js';

const cacheName = 'api-capabilities';
const cacheRoot = path.join(process.cwd(), 'tests', '.cache', cacheName);
await fsPromises.rm(cacheRoot, { recursive: true, force: true });

const { fixtureRoot, env } = await ensureFixtureIndex({
  fixtureName: 'sample',
  cacheName,
  cacheScope: 'shared'
});

const expectedToolVersion = getToolVersion() || '0.0.0';
const expectedRuntimeCapabilities = getCapabilities({ refresh: true });
const expectedManifest = getRuntimeCapabilityManifest({ runtimeCapabilities: expectedRuntimeCapabilities });

const { serverInfo, requestJson, stop } = await startApiServer({
  repoRoot: fixtureRoot,
  allowedRoots: [],
  env
});

try {
  const unauthorized = await requestJson('GET', '/capabilities', null, serverInfo, { auth: false });
  assert.equal(unauthorized.status, 401, 'api-server should reject missing auth for /capabilities');
  assert.equal(unauthorized.body?.code, 'UNAUTHORIZED', 'api-server should return UNAUTHORIZED for /capabilities');

  const capabilities = await requestJson('GET', '/capabilities', null, serverInfo);
  assert.equal(capabilities.status, 200, 'api-server /capabilities should return 200');
  assert.equal(capabilities.body?.ok, true, 'api-server /capabilities should return ok=true');
  assert.equal(capabilities.body?.schemaVersion, MCP_SCHEMA_VERSION, 'api-server /capabilities schemaVersion mismatch');
  assert.equal(capabilities.body?.toolVersion, expectedToolVersion, 'api-server /capabilities toolVersion mismatch');
  assert.deepEqual(capabilities.body?.serverInfo, {
    name: 'PairOfCleats',
    version: expectedToolVersion
  }, 'api-server /capabilities serverInfo mismatch');
  assert.deepEqual(
    capabilities.body?.capabilities,
    getApiWorkflowCapabilities({ runtimeCapabilities: expectedRuntimeCapabilities }),
    'api-server /capabilities workflow capability mask mismatch'
  );
  assert.deepEqual(
    capabilities.body?.runtimeCapabilities,
    expectedRuntimeCapabilities,
    'api-server /capabilities runtime capability payload mismatch'
  );
  assert.deepEqual(
    capabilities.body?.runtimeManifest,
    expectedManifest,
    'api-server /capabilities runtime manifest mismatch'
  );
} catch (err) {
  console.error(err?.message || err);
  process.exit(1);
} finally {
  await stop();
}

console.log('API capabilities ok.');
