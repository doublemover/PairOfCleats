#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRuntimeImportFixture } from '../../helpers/runtime-import-fixture.js';
import { importRuntimeEvidence } from '../../../src/index/semantic/runtime/import.js';
import { runRuntimeCaptureComparison, runRuntimeDerivedClaimLookup } from '../../../src/integrations/tooling/runtime-claims.js';
import { handleToolCall } from '../../../tools/mcp/tools.js';
import { createApiRouter } from '../../../tools/api/router.js';
const fixture = await createRuntimeImportFixture();
let server, router;
try {
  const first = await importRuntimeEvidence(fixture.options());
  const options = fixture.options(); options.capture = structuredClone(fixture.capture); options.capture.captureId = 'capture-b';
  options.capture.rawArtifacts.forEach(row => { row.captureId = 'capture-b'; }); options.authority = { ...options.authority, captureId: 'capture-b' };
  const second = await importRuntimeEvidence(options);
  const payload = { schemaVersion: 1, repoRoot: fixture.root, destination: 'import', request: {
    schemaVersion: 1, repositoryNamespace: fixture.capture.repositoryNamespace, generation: fixture.capture.generation,
    leftFamily: first.pointer.generationId, rightFamily: second.pointer.generationId, sources: fixture.capture.sources,
    limits: { maxRecords: 32, maxBytes: 65536, maxMs: 1000 }, persist: true } };
  const compared = await runRuntimeCaptureComparison(payload);
  assert.deepEqual(await handleToolCall('runtime_compare', payload), compared);
  const lookup = { ...payload, request: { schemaVersion: 1, repositoryNamespace: payload.request.repositoryNamespace,
    generation: payload.request.generation, claimGeneration: compared.claimGeneration, limits: payload.request.limits, cursor: null } };
  const saved = await runRuntimeDerivedClaimLookup(lookup);
  assert.deepEqual(await handleToolCall('runtime_claims', lookup), saved);
  assert.equal(saved.claims[0].evidenceClass, 'inferred'); assert.equal(saved.executionAuthorized, false);
  router = createApiRouter({ host: '127.0.0.1', defaultRepo: fixture.root, allowedRepoRoots: [fixture.root] });
  server = http.createServer((req, res) => router.handleRequest(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const post = async (route, value) => {
    const response = await fetch('http://127.0.0.1:' + server.address().port + route, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
    return { status: response.status, body: await response.json() };
  };
  assert.deepEqual((await post('/analysis/runtime-compare', payload)).body.result, compared);
  assert.deepEqual((await post('/analysis/runtime-claims', lookup)).body.result, saved);
  assert.equal((await post('/analysis/runtime-compare', { ...payload, execute: true })).status, 400);
  assert.equal((await post('/analysis/runtime-claims', { ...lookup, destination: path.dirname(fixture.root) })).status, 403);
  assert.equal((await post('/analysis/runtime-claims', { ...lookup, request: { ...lookup.request, cursor: 'foreign' } })).status, 410);
  assert.equal((await post('/analysis/runtime-claims', { ...lookup, request: { ...lookup.request, claimGeneration: '0'.repeat(64) } })).status, 404);
  const filename = path.join(fixture.root, 'request.json'), execute = promisify(execFile);
  for (const [operation, value, expected] of [['compare', payload, compared], ['claims', lookup, saved]]) {
    await fs.writeFile(filename, JSON.stringify(value));
    const result = await execute(process.execPath, ['bin/pairofcleats.js', 'runtime', operation, '--request', filename], {
      cwd: process.cwd(), timeout: 15000, maxBuffer: 1048576 });
    assert.deepEqual(JSON.parse(result.stdout), expected);
  }
  console.log('runtime compare/claims API MCP CLI parity passed');
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await router?.shutdown?.(); await fixture.cleanup();
}
