#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRuntimeImportFixture } from '../../helpers/runtime-import-fixture.js';
import { importRuntimeEvidence } from '../../../src/index/semantic/runtime/import.js';
import { defaultRuntimeQuerySelectors } from '../../../src/index/semantic/runtime/query.js';
import { runRuntimeEvidenceLookup, runRuntimeFamilyDiscovery } from '../../../src/integrations/tooling/runtime-evidence.js';
import { getRepoCacheRoot } from '../../../src/shared/dict-utils.js';
import { handleToolCall } from '../../../tools/mcp/tools.js';
import { getToolDefs, MCP_SCHEMA_VERSION } from '../../../src/integrations/mcp/defs.js';
import { getRuntimeCapabilityManifest } from '../../../src/shared/runtime-capability-manifest.js';
import { createApiRouter } from '../../../tools/api/router.js';

const fixture = await createRuntimeImportFixture();
const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-runtime-outside-'));
let server, router;
try {
  const imported = await importRuntimeEvidence(fixture.options());
  const payload = { schemaVersion: 1, repoRoot: fixture.root, destination: 'import', request: {
    schemaVersion: 1, repositoryNamespace: fixture.capture.repositoryNamespace, generation: fixture.capture.generation,
    familyGenerations: [imported.pointer.generationId], selectors: defaultRuntimeQuerySelectors(),
    limits: { maxRecords: 2, maxBytes: 65536, maxMs: 1000 }, cursor: null } };
  const discovery = { schemaVersion: 1, repoRoot: fixture.root, destination: 'import',
    limits: { maxFamilies: 1, maxScan: 32, maxBytes: 65536, maxMs: 1000 }, cursor: null };
  const clean = result => ({ ...result, cost: result.cost ? { ...result.cost, elapsedMs: 0, responseBytes: 0 } : undefined });
  const expected = await runRuntimeEvidenceLookup(payload);
  assert.equal(expected.observations.length, 2); assert.ok(expected.nextCursor);
  assert.equal(MCP_SCHEMA_VERSION, '1.4.4');
  for (const name of ['runtime_evidence', 'runtime_families']) assert.ok(getToolDefs().some(tool => tool.name === name && tool.inputSchema.additionalProperties === false));
  assert.deepEqual(clean(await handleToolCall('runtime_evidence', payload)), clean(expected));
  const families = await runRuntimeFamilyDiscovery(discovery);
  assert.deepEqual(await handleToolCall('runtime_families', discovery), families);
  assert.equal(families.families[0].generationId, imported.pointer.generationId);
  assert.equal(families.families[0].queryIndexState, 'available');
  const manifest = getRuntimeCapabilityManifest({ runtimeCapabilities: {} });
  assert.equal(manifest.surfaces.api.workflowCapabilities['runtime-evidence'], true);
  assert.ok(manifest.surfaces.api.routes.some(route => route.path === '/analysis/runtime-families'));
  router = createApiRouter({ host: '127.0.0.1', defaultRepo: fixture.root, allowedRepoRoots: [fixture.root] });
  server = http.createServer((req, res) => router.handleRequest(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const post = async (route, value) => {
    const response = await fetch('http://127.0.0.1:' + server.address().port + route, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
    return { status: response.status, body: await response.json() };
  };
  const response = await post('/analysis/runtime-evidence', payload);
  assert.equal(response.status, 200); assert.deepEqual(clean(response.body.result), clean(expected));
  const found = await post('/analysis/runtime-families', discovery);
  assert.equal(found.status, 200); assert.deepEqual(found.body.result, families);
  assert.equal((await post('/analysis/runtime-evidence', { ...payload, execute: true })).status, 400);
  assert.equal((await post('/analysis/runtime-evidence', { ...payload, request: { ...payload.request, cursor: 'foreign-cursor' } })).status, 410);
  assert.equal((await post('/analysis/runtime-evidence', { ...payload,
    request: { ...payload.request, generation: { baseBuildId: 'wrong-source-build', semanticRevision: 0 } } })).status, 409);
  assert.equal((await post('/analysis/runtime-evidence', { ...payload, request: { ...payload.request, familyGenerations: ['0'.repeat(64)] } })).status, 404);
  assert.equal((await post('/analysis/runtime-evidence', { ...payload, destination: outside })).status, 403);
  assert.equal((await post('/analysis/runtime-families', { ...discovery, destination: outside })).status, 403);
  assert.equal((await post('/analysis/runtime-evidence', { ...payload, repoRoot: outside })).status, 403);
  await assert.rejects(handleToolCall('runtime_evidence', { ...payload, destination: outside }), { code: 'ERR_RUNTIME_DESTINATION_FORBIDDEN' });
  const escape = path.join(fixture.root, 'escape');
  await fs.symlink(outside, escape, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await post('/analysis/runtime-evidence', { ...payload, destination: 'escape' })).status, 403);
  const ownedCache = path.join(getRepoCacheRoot(fixture.root, {}), 'runtime-evidence');
  await fs.mkdir(path.dirname(ownedCache), { recursive: true });
  await fs.cp(fixture.options().destination, ownedCache, { recursive: true });
  assert.deepEqual(clean(await runRuntimeEvidenceLookup({ ...payload, destination: ownedCache })), clean(expected));
  const execute = promisify(execFile), requestPath = path.join(fixture.root, 'query.json');
  await fs.writeFile(requestPath, JSON.stringify(payload));
  const { stdout } = await execute(process.execPath, ['bin/pairofcleats.js', 'runtime', 'lookup', '--request', requestPath, '--all'], {
    cwd: process.cwd(), timeout: 15000, maxBuffer: 1048576 });
  const pages = stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(pages.length, 4); assert.equal(pages.at(-1).nextCursor, null);
  assert.equal(new Set(pages.flatMap(page => page.observations.map(row => row.evidenceId))).size, 7);
  assert.ok(pages.every(page => page.executionAuthorized === false));
  await fs.writeFile(requestPath, JSON.stringify(discovery));
  const listing = await execute(process.execPath, ['bin/pairofcleats.js', 'runtime', 'families', '--request', requestPath], {
    cwd: process.cwd(), timeout: 15000, maxBuffer: 1048576 });
  assert.deepEqual(JSON.parse(listing.stdout), families);
  const familyManifest = path.join(fixture.options().destination, 'generations', imported.pointer.generationId, 'manifest.json');
  const original = await fs.readFile(familyManifest);
  const old = JSON.parse(original); delete old.queryIndex;
  await fs.writeFile(familyManifest, JSON.stringify(old));
  const unavailable = await post('/analysis/runtime-evidence', payload);
  assert.equal(unavailable.status, 409); assert.equal(unavailable.body.runtimeCode, 'ERR_RUNTIME_QUERY_INDEX_UNAVAILABLE');
  await fs.writeFile(familyManifest, original);
  console.log('saved runtime CLI/MCP/HTTP lookup and discovery share exact scope, bounded pages and canonical destination authority');
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  router?.close(); await fixture.cleanup(); await fs.rm(outside, { recursive: true, force: true });
}
