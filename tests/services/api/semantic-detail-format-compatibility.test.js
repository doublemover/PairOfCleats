import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { formatToolError } from '../../../src/integrations/mcp/protocol.js';
import { handleToolCall } from '../../../tools/mcp/tools.js';
import { createSemanticDetailFixture } from '../../helpers/api-semantic-detail-fixture.js';

const versions = { missing: undefined, legacy: '0.0.2', future: '0.1.1' };
const caseId = process.env.PAIROFCLEATS_TEST_ID?.split('services/api/semantic-detail-format-compatibility/')[1];
assert.ok(Object.hasOwn(versions, caseId), 'select one independently bounded format case through tests/run.js');
assert.deepEqual(JSON.parse(await fs.readFile(new URL('./semantic-detail-format-compatibility.test.js.cases.json', import.meta.url))),
  { schemaVersion: 1, cases: Object.keys(versions) });
const version = versions[caseId];
const fixture = await createSemanticDetailFixture();
try {
  const { repoRoot, indexDir, request, file, post } = fixture;
  await fixture.publishNewGeneration();
  // Corrupt the retained requested generation, while current points elsewhere.
  const piecePath = path.join(indexDir, 'pieces', 'manifest.json');
  const originalPieces = await fs.readFile(piecePath, 'utf8');
  try {
    await fs.writeFile(piecePath, JSON.stringify({ ...JSON.parse(originalPieces), artifactSurfaceVersion: version }));
    const rejected = await post(request);
    assert.equal(rejected.status, 409);
    assert.equal(rejected.body.nativeCode, 'ERR_INDEX_FORMAT_UNSUPPORTED');
    assert.equal(path.resolve(rejected.body.repoRoot).toLowerCase(), path.resolve(repoRoot).toLowerCase());
    assert.equal(path.resolve(rejected.body.indexPath).toLowerCase(), path.resolve(piecePath).toLowerCase());
    assert.equal(rejected.body.rebuildCommand, 'pairofcleats index build --repo "' + rejected.body.repoRoot + '" --mode all');
    const error = await handleToolCall('semantic_detail', request).then(() => assert.fail('MCP must reject'), error => error);
    const projected = formatToolError(error);
    assert.equal(projected.nativeCode, rejected.body.nativeCode);
    assert.equal(projected.rebuildCommand, rejected.body.rebuildCommand);
    const cli = await promisify(execFile)(process.execPath, ['bin/pairofcleats.js', 'semantic', 'detail', '--request', file], { cwd: process.cwd(), timeout: 10000 }).then(() => assert.fail('CLI must reject'), error => error);
    assert.equal(cli.code, 1, 'the CLI rejects a format conflict rather than timing out or crashing');
    const diagnostic = JSON.parse(cli.stderr.trim());
    assert.equal(diagnostic.code, rejected.body.nativeCode);
    for (const key of ['operation', 'component', 'expectedVersion', 'foundVersion', 'repoRoot', 'indexPath', 'rebuildCommand']) assert.deepEqual(diagnostic[key], rejected.body[key]);
  } finally {
    await fs.writeFile(piecePath, originalPieces);
  }
  const semanticPath = path.join(indexDir, 'semantic_manifest.json');
  const originalSemantic = await fs.readFile(semanticPath, 'utf8');
  try {
    await fs.writeFile(semanticPath, JSON.stringify({ ...JSON.parse(originalSemantic), artifactSurfaceVersion: version }));
    const rejected = await post(request);
    assert.equal(rejected.status, 409);
    assert.equal(rejected.body.component, 'semantic manifest');
    assert.equal(path.resolve(rejected.body.indexPath).toLowerCase(), path.resolve(semanticPath).toLowerCase());
  } finally {
    await fs.writeFile(semanticPath, originalSemantic);
  }
  console.log(`Semantic detail ${caseId} format compatibility passed`);
} finally {
  await fixture.close();
}
