import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRiskRepoIndexFixture } from '../helpers/risk-pack-eval.js';
import { createAnalysisSurfaceHarness } from '../helpers/analysis-surface-parity.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { buildCompositeContextPackPayload } from '../../src/integrations/tooling/context-pack.js';
import { assembleCompositeContextPackStreaming } from '../../src/context-pack/assemble.js';
import { buildCliContextPackRequestInput } from '../../src/shared/context-pack-request.js';
import { validateCompositeContextPack } from '../../src/contracts/validators/analysis.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-context-task-surfaces-'));
const repo = path.join(root, 'repo'), cacheRoot = path.join(root, 'cache');
await fs.mkdir(repo); applyTestEnv({ cacheRoot, embeddings: 'off' });
const text = '// e\u0301 😀\r\n\texport function intact() {\r\n\t  return "界";\r\n\t}\r\n';
const taskPolicy = { schemaVersion: 1, task: 'edit-safe', granularity: 'file', wholeFileFallback: false };
const tree = async directory => {
  const files = await fs.readdir(directory, { recursive: true, withFileTypes: true });
  const result = [];
  for (const file of files.filter(row => row.isFile())) {
    const absolute = path.join(file.parentPath, file.name);
    result.push([path.relative(directory, absolute), createHash('sha256').update(await fs.readFile(absolute)).digest('hex')]);
  }
  return result.sort(([a], [b]) => a.localeCompare(b));
};
let harness;
try {
  const { finalIndexDir } = await createRiskRepoIndexFixture({ repoPath: repo, cacheRoot, fileRelPath: 'source.js', sourceText: text,
    alias: 'task-policy', generatedAt: '2026-10-23T00:00:00.000Z', compatibilityKey: 'task-policy-v1' });
  const metadataPath = path.join(finalIndexDir, 'chunk_meta.json');
  const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
  Object.assign(metadata[0], { fileHash: createHash('sha1').update(text).digest('hex'), fileHashAlgo: 'sha1' });
  await fs.writeFile(metadataPath, JSON.stringify(metadata));
  const args = { repoPath: repo, seed: 'chunk:chunk-risk', hops: 0, includeGraph: false, strictEvidence: true, taskPolicy };
  const before = await tree(finalIndexDir);
  harness = await createAnalysisSurfaceHarness({ fixtureRoot: repo, env: process.env });
  const api = await harness.runApi('/analysis/context-pack', args), mcp = await harness.runMcp('context_pack', args);
  assert.equal(api.status, 200, JSON.stringify(api.parsed)); assert.equal(mcp.ok, true, mcp.error?.message);
  const cliProjection = buildCliContextPackRequestInput({ ...args, taskPolicy: undefined,
    task: 'edit-safe', granularity: 'file', wholeFileFallback: false }, { repoRoot: repo });
  const direct = await buildCompositeContextPackPayload(cliProjection);
  for (const pack of [api.parsed.result, mcp.result, direct]) {
    assert.equal(pack.primary.excerpt, text); assert.equal(pack.primary.unit.granularity, 'file');
    assert.equal(pack.evidence.complete, true); assert.equal(validateCompositeContextPack(pack).ok, true);
  }
  assert.deepEqual(api.parsed.result.primary.unit, mcp.result.primary.unit);
  for (const [override, status, reason] of [
    [{ maxTokens: 1 }, 413, 'ERR_CONTEXT_PACK_UNIT_CANNOT_FIT'],
    [{ taskPolicy: { ...taskPolicy, granularity: 'function' } }, 400, 'ERR_CONTEXT_PACK_UNIT_UNAVAILABLE'],
    [{ maxWallClockMs: 0 }, 408, 'ERR_CONTEXT_PACK_UNIT_DEADLINE']
  ]) {
    const request = { ...args, ...override }, failedApi = await harness.runApi('/analysis/context-pack', request);
    const failedMcp = await harness.runMcp('context_pack', request);
    assert.equal(failedApi.status, status, JSON.stringify(failedApi.parsed)); assert.equal(failedApi.parsed.reason, reason);
    assert.equal(failedMcp.ok, false); assert.equal(failedMcp.error.reason, reason);
  }
  assert.equal((await harness.runApi('/analysis/context-pack', { ...args, taskPolicy: { ...taskPolicy, schemaVersion: 2 } })).status, 400);
  await fs.writeFile(path.join(repo, 'source.js'), text + '// drift\r\n');
  const changedApi = await harness.runApi('/analysis/context-pack', args), changedMcp = await harness.runMcp('context_pack', args);
  assert.equal(changedApi.status, 409); assert.equal(changedMcp.ok, false);
  assert.equal(changedMcp.error.reason, 'ERR_CONTEXT_PACK_SOURCE_MISMATCH');
  await fs.writeFile(path.join(repo, 'source.js'), text);
  assert.deepEqual(await tree(finalIndexDir), before, 'first/repeat/failed edit requests leave the published generation unchanged');
  const frozen = path.join(root, 'snapshots', 'retained', 'frozen', 'index-code');
  await fs.cp(finalIndexDir, frozen, { recursive: true });
  const frozenBefore = await tree(frozen);
  for (let iteration = 0; iteration < 2; iteration++) {
    const retained = await assembleCompositeContextPackStreaming({ repoRoot: repo, indexDir: frozen,
      seed: { type: 'chunk', chunkUid: 'chunk-risk' }, includeGraph: false, taskPolicy,
      indexSignature: 'historical-retained-file', strictEvidence: true });
    assert.equal(retained.primary.excerpt, text);
  }
  assert.deepEqual(await tree(frozen), frozenBefore, 'historical intact-unit reads publish no derived files into the frozen tree');
} finally { if (harness) await harness.close(); await fs.rm(root, { recursive: true, force: true }); }
console.log('Context task policies agree through direct tooling, HTTP, MCP and historical read-only assembly.');
