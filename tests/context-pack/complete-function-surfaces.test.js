import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRiskRepoIndexFixture } from '../helpers/risk-pack-eval.js';
import { createAnalysisSurfaceHarness, runCliJson } from '../helpers/analysis-surface-parity.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { buildCompositeContextPackPayload } from '../../src/integrations/tooling/context-pack.js';
import { assembleCompositeContextPackStreaming } from '../../src/context-pack/assemble.js';
import { validateCompositeContextPack } from '../../src/contracts/validators/analysis.js';
import { renderCompositeContextPack } from '../../src/retrieval/output/composite-context-pack.js';

// UNVALIDATED: real bounded surfaces; CLI case uses the existing hidden launcher.
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['cli', 'http', 'mcp', 'historical', 'text'].includes(selected));
const parent = path.resolve('.tmp/tasks'); await fs.mkdir(parent, { recursive: true });
const root = await fs.mkdtemp(path.join(parent, 'function-surface-'));
const repo = path.join(root, 'repo'), cacheRoot = path.join(root, 'cache');
await fs.mkdir(repo); applyTestEnv({ cacheRoot, embeddings: 'off' });
const text = 'export function intact() {\r\n\treturn "界😀 e\u0301";\r\n}';
const taskPolicy = { schemaVersion: 1, task: 'edit-safe', granularity: 'function', wholeFileFallback: false };
const inventory = async directory => {
  const files = await fs.readdir(directory, { recursive: true, withFileTypes: true });
  const result = [];
  for (const file of files.filter(row => row.isFile())) {
    const absolute = path.join(file.parentPath, file.name);
    result.push([path.relative(directory, absolute), createHash('sha256').update(await fs.readFile(absolute)).digest('hex')]);
  }
  return result.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
};
let harness;
try {
  const { finalIndexDir } = await createRiskRepoIndexFixture({ repoPath: repo, cacheRoot, fileRelPath: 'source.js', sourceText: text,
    alias: 'complete-function', generatedAt: '2026-10-28T00:00:00.000Z', compatibilityKey: 'complete-function-v2' });
  const metadataPath = path.join(finalIndexDir, 'chunk_meta.json');
  const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
  Object.assign(metadata[0], { fileHash: createHash('sha1').update(text).digest('hex'), fileHashAlgo: 'sha1' });
  await fs.writeFile(metadataPath, JSON.stringify(metadata));
  const before = await inventory(finalIndexDir);
  const args = { repoPath: repo, seed: 'chunk:chunk-risk', hops: 0, includeGraph: false, strictEvidence: true, taskPolicy };
  let pack;
  if (selected === 'cli') {
    const result = runCliJson(['context-pack', '--repo', repo, '--seed', args.seed, '--hops', '0', '--includeGraph=false',
      '--strictEvidence', '--task', 'edit-safe', '--granularity', 'function', '--json']);
    assert.equal(result.status, 0, result.stderr); pack = result.parsed;
  } else if (selected === 'http' || selected === 'mcp') {
    harness = await createAnalysisSurfaceHarness({ fixtureRoot: repo, env: process.env });
    if (selected === 'http') {
      const response = await harness.runApi('/analysis/context-pack', args);
      assert.equal(response.status, 200, JSON.stringify(response.parsed)); pack = response.parsed.result;
    } else {
      const response = await harness.runMcp('context_pack', args);
      assert.equal(response.ok, true, response.error?.message); pack = response.result;
    }
  } else if (selected === 'historical') {
    const frozen = path.join(root, 'snapshots', 'retained', 'frozen', 'index-code');
    await fs.cp(finalIndexDir, frozen, { recursive: true }); const frozenBefore = await inventory(frozen);
    for (let iteration = 0; iteration < 2; iteration++) pack = await assembleCompositeContextPackStreaming({
      repoRoot: repo, indexDir: frozen, seed: { type: 'chunk', chunkUid: 'chunk-risk' }, includeGraph: false,
      taskPolicy, strictEvidence: true, indexSignature: 'historical-function-generation' });
    assert.deepEqual(await inventory(frozen), frozenBefore);
  } else pack = await buildCompositeContextPackPayload({ ...args, repoRoot: repo });
  assert.equal(pack.primary.excerpt, text); assert.equal(pack.primary.unit.schemaVersion, 2);
  assert.equal(pack.primary.unit.granularity, 'function'); assert.deepEqual(pack.primary.unit.span, [0, text.length]);
  assert.equal(pack.primary.unit.fallbackUsed, false); assert.equal(pack.evidence.complete, true);
  assert.equal(validateCompositeContextPack(pack).ok, true);
  if (selected === 'text') {
    const rendered = renderCompositeContextPack(pack);
    assert.ok(rendered.includes(`UTF-16 [0, ${text.length})`)); assert.ok(rendered.includes(pack.primary.unit.sourceHash));
    assert.ok(rendered.includes(pack.primary.unit.contentHash)); assert.ok(rendered.includes('Complete function:\n' + text));
    assert.equal(rendered.includes('Whole-file fallback:'), false);
  }
  assert.deepEqual(await inventory(finalIndexDir), before, 'surface requests cannot mutate the selected generation');
} finally { if (harness) await harness.close(); await fs.rm(root, { recursive: true, force: true }); }
console.log(`Complete function original-source surface: ${selected}`);
