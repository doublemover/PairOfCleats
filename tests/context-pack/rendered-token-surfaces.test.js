import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Tokenizer } from '@huggingface/tokenizers';
import { createContextTokenizerProfile } from '../helpers/context-tokenizer-profile.js';
import { createRiskRepoIndexFixture } from '../helpers/risk-pack-eval.js';
import { createAnalysisSurfaceHarness, runCliJson } from '../helpers/analysis-surface-parity.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { validateCompositeContextPack } from '../../src/contracts/validators/analysis.js';
import { buildCompositeContextPackPayload } from '../../src/integrations/tooling/context-pack.js';

// UNVALIDATED: independent real CLI/HTTP/MCP commands, actual worker teardown,
// exact intact-source identity and canonical invalid/overflow contracts.
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['cli', 'http', 'mcp', 'invalid', 'overflow'].includes(selected));
const parent = path.resolve('.tmp/tasks'); await fs.mkdir(parent, { recursive: true });
const root = await fs.mkdtemp(path.join(parent, 'token-surface-'));
const repo = path.join(root, 'repo'), cacheRoot = path.join(root, 'cache');
await fs.mkdir(repo); applyTestEnv({ cacheRoot, embeddings: 'off' });
let harness;
try {
  const sourceText = 'export function intact() {\r\n\treturn "界😀 e\u0301";\r\n}';
  const { finalIndexDir } = await createRiskRepoIndexFixture({ repoPath: repo, cacheRoot, fileRelPath: 'source.js', sourceText,
    alias: 'exact-rendered', generatedAt: '2026-10-28T00:00:00.000Z', compatibilityKey: 'exact-rendered-v1' });
  const metadataPath = path.join(finalIndexDir, 'chunk_meta.json');
  const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
  Object.assign(metadata[0], { fileHash: createHash('sha1').update(sourceText).digest('hex'), fileHashAlgo: 'sha1' });
  await fs.writeFile(metadataPath, JSON.stringify(metadata));
  const profile = await createContextTokenizerProfile(repo);
  const args = { repoPath: repo, seed: 'chunk:chunk-risk', hops: 0, includeGraph: false, strictEvidence: true,
    taskPolicy: { schemaVersion: 1, task: 'edit-safe', granularity: 'function', wholeFileFallback: false },
    renderedTokenBudget: profile.input };
  const inventory = await fs.readFile(metadataPath, 'utf8');
  let pack;
  if (selected === 'cli') {
    const result = runCliJson(['context-pack', '--repo', repo, '--seed', args.seed, '--hops', '0', '--includeGraph=false',
      '--strictEvidence', '--task', 'edit-safe', '--granularity', 'function', '--renderedTokenBudget', JSON.stringify(profile.input), '--json']);
    assert.equal(result.status, 0, result.stderr); pack = result.parsed;
  } else if (selected === 'http' || selected === 'mcp') {
    harness = await createAnalysisSurfaceHarness({ fixtureRoot: repo, env: process.env });
    if (selected === 'http') {
      const response = await harness.runApi('/analysis/context-pack', args);
      assert.equal(response.status, 200, JSON.stringify(response.parsed)); pack = response.parsed.result;
    } else {
      const response = await harness.runMcp('context_pack', args);
      assert.equal(response.ok, true, JSON.stringify(response.error)); pack = response.result;
    }
  } else {
    harness = await createAnalysisSurfaceHarness({ fixtureRoot: repo, env: process.env });
    const renderedTokenBudget = selected === 'invalid' ? { ...profile.input, extra: true } : { ...profile.input, maxTokens: 0 };
    const response = await harness.runApi('/analysis/context-pack', { ...args, renderedTokenBudget });
    assert.equal(response.status, selected === 'invalid' ? 400 : 413, JSON.stringify(response.parsed));
    const mcp = await harness.runMcp('context_pack', { ...args, renderedTokenBudget });
    assert.equal(mcp.ok, false); assert.equal(mcp.error?.code, 'INVALID_REQUEST');
    await assert.rejects(buildCompositeContextPackPayload({ ...args, repoRoot: repo, renderedTokenBudget }),
      error => error.code === (selected === 'invalid' ? 'ERR_CONTEXT_PACK_INVALID_REQUEST' : 'ERR_CONTEXT_PACK_TOKEN_BUDGET'));
  }
  if (pack) {
    assert.equal(pack.primary.excerpt, sourceText); assert.equal(pack.primary.unit.granularity, 'function');
    assert.equal(pack.evidence.complete, true); assert.equal(validateCompositeContextPack(pack).ok, true);
    const count = new Tokenizer(profile.tokenizer, profile.config).encode(pack.renderedContext, { add_special_tokens: true }).ids.length;
    assert.equal(pack.tokenAccounting.renderedTokens, count); assert.equal(pack.tokenAccounting.status, 'exact');
    assert.ok(pack.renderedContext.includes(sourceText));
  }
  assert.equal(await fs.readFile(metadataPath, 'utf8'), inventory, 'counting cannot mutate the selected generation');
} finally { if (harness) await harness.close(); await fs.rm(root, { recursive: true, force: true }); }
console.log(`Exact rendered token surface: ${selected}`);
