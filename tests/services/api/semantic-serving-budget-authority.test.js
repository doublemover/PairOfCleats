import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { createSemanticServingFixture } from '../../helpers/semantic-serving-fixture.js';
import { createApiRouter } from '../../../tools/api/router.js';
import { handleToolCall } from '../../../tools/mcp/tools.js';
import { formatToolError } from '../../../src/integrations/mcp/protocol.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { projectOutput } from '../../../src/map/workspace/projection.js';
import { semanticDetailInput } from '../../../src/map/workspace/request.js';

// Actual published readers, HTTP router and MCP tool dispatch. No whole index,
// native SQLite substitute, provider execution or physical link is involved.
const fixture = await createSemanticServingFixture({ withOperands: true });
let server, router;
try {
  const currentGeneration = { baseBuildId: 'new-current-build', semanticRevision: 0 };
  const buildsRoot = path.dirname(path.dirname(fixture.indexDir));
  const currentIndex = path.join(buildsRoot, currentGeneration.baseBuildId, 'index-code');
  await fs.cp(fixture.indexDir, currentIndex, { recursive: true });
  const registrations = structuredClone(fixture.registration); registrations.buildId = currentGeneration.baseBuildId;
  for (const name of fixture.originals.keys()) {
    const value = JSON.parse(fixture.originals.get(name)); value.generation = currentGeneration;
    const bytes = Buffer.from(JSON.stringify(value)); await fs.writeFile(path.join(currentIndex, name + '.json'), bytes);
    const piece = registrations.pieces.find(piece => piece.name === name);
    piece.bytes = bytes.length; piece.checksum = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
  }
  await fs.writeFile(path.join(currentIndex, 'pieces', 'manifest.json'), JSON.stringify(registrations));
  await fs.writeFile(path.join(buildsRoot, 'current.json'), JSON.stringify({
    artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, buildId: currentGeneration.baseBuildId, modes: ['code']
  }));
  router = createApiRouter({ host: '127.0.0.1', defaultRepo: fixture.root, allowedRepoRoots: [fixture.root] });
  server = http.createServer((req, res) => router.handleRequest(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const post = async (operation, request) => {
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/analysis/semantic-' + operation, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request)
    });
    return { status: response.status, body: await response.json() };
  };
  const scope = { repoRoot: fixture.root, generation: fixture.generation };
  const findRequest = { ...scope, selector: { field: 'astKind', value: 'Identifier' }, limits: { records: 1 } };
  const found = await post('find', findRequest);
  assert.equal(found.status, 200); assert.ok(found.body.result.cursor);
  assert.deepEqual(found.body.result.generation, fixture.generation);
  const projection = projectOutput(found.body), selected = projection.nodes[0];
  assert.equal(Object.hasOwn(selected.detail, 'generation'), false, 'the canonical record uses its envelope generation');
  const detailRequest = semanticDetailInput(selected, projection, fixture.root);
  assert.deepEqual(detailRequest.generation, fixture.generation);
  assert.deepEqual(detailRequest.refs, [fixture.ref]);
  const hydrated = await post('detail', detailRequest);
  assert.equal(hydrated.status, 200); assert.deepEqual(hydrated.body.result.generation, fixture.generation);
  assert.equal(hydrated.body.result.operands[0].child.localId, 1, 'find→select→detail hydrates retained operands');
  const mcpDetail = await handleToolCall('semantic_detail', detailRequest);
  assert.deepEqual(mcpDetail.generation, fixture.generation); assert.deepEqual(mcpDetail.operands, hydrated.body.result.operands);
  const mcpFound = await handleToolCall('semantic_find', findRequest);
  assert.deepEqual(mcpFound.records, found.body.result.records);
  const next = await post('find', { ...findRequest, cursor: found.body.result.cursor });
  assert.equal(next.status, 200); assert.equal(next.body.result.records[0].id, 1);
  assert.equal((await post('find', { ...findRequest, selector: { field: 'astKind', value: 'Absent' }, cursor: found.body.result.cursor })).status, 410);
  assert.equal((await post('detail', { ...detailRequest, generation: { ...fixture.generation, baseBuildId: 'missing-generation' } })).status, 409);
  const missingGeneration = { ...detailRequest }; delete missingGeneration.generation;
  assert.equal((await post('detail', missingGeneration)).status, 400);
  await assert.rejects(handleToolCall('semantic_detail', missingGeneration), { code: 'ERR_SEMANTIC_QUERY_CONTRACT' });
  assert.equal((await post('detail', { ...detailRequest, repoRoot: path.dirname(fixture.root) })).status, 403);
  const explainRequest = { ...scope, seed: fixture.ref, direction: 'downstream', kinds: ['flowsTo'] };
  const explained = await post('explain', explainRequest);
  assert.equal(explained.status, 200); assert.deepEqual(explained.body.result.generation, fixture.generation);
  assert.deepEqual((await handleToolCall('semantic_explain', explainRequest)).records, explained.body.result.records);
  for (const operation of ['trace', 'explain']) {
    const profiled = { ...explainRequest, pathSemantics: 'balanced-call-value' };
    const response = await post(operation, profiled);
    assert.equal(response.status, 200);
    assert.equal(response.body.result.pathCapability.declaration.operation, 'semantic_' + operation);
    assert.equal(response.body.result.pathCapability.declaration.feasibility, 'unsupported');
    assert.deepEqual(response.body.result.pathCapability.scope.generation, fixture.generation);
    const mcp = await handleToolCall('semantic_' + operation, profiled);
    assert.deepEqual(mcp.pathCapability, response.body.result.pathCapability);
    assert.equal((await post(operation, { ...profiled, pathSemantics: 'graph-witness' })).status, 400);
  }
  // Exercise #1425 through the actual empty and all-range-rejected buckets,
  // including the exact final UTF-8 envelope boundary on both adapters.
  for (const selector of [{ field: 'astKind', value: '界😀-absent' },
    { field: 'sourcePath', value: 'original.js', range: { start: 100, end: 101 } }]) {
    const request = { ...scope, selector };
    const baseline = await handleToolCall('semantic_find', request);
    const bytes = Buffer.byteLength(JSON.stringify(baseline)); assert.deepEqual(baseline.records, []);
    for (const limit of [1, bytes - 1]) {
      const response = await post('find', { ...request, limits: { bytes: limit } });
      assert.equal(response.status, 400);
      let failure;
      try { await handleToolCall('semantic_find', { ...request, limits: { bytes: limit } }); assert.fail('must reject'); }
      catch (error) { failure = error; }
      const wire = JSON.parse(JSON.stringify(formatToolError(failure)));
      assert.equal(wire.code, 'INVALID_REQUEST'); assert.equal(wire.nativeCode, 'ERR_SEMANTIC_OUTPUT_LIMIT');
    }
    for (const limit of [bytes, bytes + 1]) {
      const response = await post('find', { ...request, limits: { bytes: limit } });
      assert.equal(response.status, 200); assert.deepEqual(response.body.result.records, []);
      assert.ok(Buffer.byteLength(JSON.stringify(response.body.result)) <= limit);
      const mcp = await handleToolCall('semantic_find', { ...request, limits: { bytes: limit } });
      assert.ok(Buffer.byteLength(JSON.stringify(mcp)) <= limit);
    }
  }
} finally {
  if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  router?.close(); await fixture.cleanup();
}
console.log('Actual semantic transports preserve envelope hydration authority and final empty-result byte bounds.');
